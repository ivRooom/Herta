import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  decryptRuntimeSecret,
  encryptRuntimeSecret,
  readRuntimeSecret,
  resolveRuntimeSecretMasterKey,
  RuntimeSecretError,
  validateRuntimeSecretName,
  validateRuntimeSecretValue,
} from './runtime-secrets.js';

const MASTER_KEY = Buffer.alloc(32, 0x42);
const MASTER_KEY_BASE64 = MASTER_KEY.toString('base64');

test('runtime secret encrypts and decrypts with AES-256-GCM without plaintext leakage', () => {
  const encrypted = encryptRuntimeSecret('openai.api_key', 'sk-example-secret-value', MASTER_KEY);

  assert.equal(encrypted.iv.byteLength, 12);
  assert.equal(encrypted.authTag.byteLength, 16);
  assert.equal(encrypted.keyVersion, 1);
  assert.equal(encrypted.ciphertext.includes(Buffer.from('sk-example-secret-value')), false);
  assert.equal(
    decryptRuntimeSecret('openai.api_key', encrypted, MASTER_KEY),
    'sk-example-secret-value',
  );
});

test('AAD binds ciphertext to the runtime secret name', () => {
  const encrypted = encryptRuntimeSecret('openai.api_key', 'secret-value', MASTER_KEY);

  assert.throws(
    () => decryptRuntimeSecret('other.api_key', encrypted, MASTER_KEY),
    (error: unknown) => error instanceof RuntimeSecretError && error.code === 'decrypt_failed',
  );
});

test('wrong master key cannot decrypt a runtime secret', () => {
  const encrypted = encryptRuntimeSecret('openai.api_key', 'secret-value', MASTER_KEY);
  const wrongKey = Buffer.alloc(32, 0x99);

  assert.throws(
    () => decryptRuntimeSecret('openai.api_key', encrypted, wrongKey),
    (error: unknown) => error instanceof RuntimeSecretError && error.code === 'decrypt_failed',
  );
});

test('master key accepts exact 32-byte base64 and rejects missing or invalid values', () => {
  const resolved = resolveRuntimeSecretMasterKey({ HERTA_RUNTIME_SECRET_KEY: MASTER_KEY_BASE64 });
  assert.equal(resolved.equals(MASTER_KEY), true);
  resolved.fill(0);

  assert.throws(
    () => resolveRuntimeSecretMasterKey({}),
    (error: unknown) => error instanceof RuntimeSecretError && error.code === 'missing_master_key',
  );
  assert.throws(
    () => resolveRuntimeSecretMasterKey({ HERTA_RUNTIME_SECRET_KEY: 'too-short' }),
    (error: unknown) => error instanceof RuntimeSecretError && error.code === 'invalid_master_key',
  );
});

test('runtime secret reads fail closed on a missing master key even when no secret is stored', async () => {
  const prisma = {
    runtimeSecret: {
      findUnique: async () => null,
    },
  } as unknown as PrismaClient;

  await assert.rejects(
    () => readRuntimeSecret(prisma, 'openai.api_key', {}),
    (error: unknown) => error instanceof RuntimeSecretError && error.code === 'missing_master_key',
  );

  assert.equal(
    await readRuntimeSecret(prisma, 'openai.api_key', {
      HERTA_RUNTIME_SECRET_KEY: MASTER_KEY_BASE64,
    }),
    null,
  );
});

test('runtime secret names and values are bounded and normalized', () => {
  assert.equal(validateRuntimeSecretName(' OpenAI.API_Key '), 'openai.api_key');
  assert.equal(validateRuntimeSecretValue('  secret-value  '), 'secret-value');

  assert.throws(() => validateRuntimeSecretName('../secret'));
  assert.throws(() => validateRuntimeSecretName('a'.repeat(101)));
  assert.throws(() => validateRuntimeSecretValue(''));
  assert.throws(() => validateRuntimeSecretValue('line1\nline2'));
  assert.throws(() => validateRuntimeSecretValue('x'.repeat(4097)));
});
