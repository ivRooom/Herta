import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const OPENAI_API_KEY_RUNTIME_SECRET = 'openai.api_key';
export const RUNTIME_SECRET_KEY_VERSION = 1;

const RUNTIME_SECRET_MASTER_KEY_ENV = 'HERTA_RUNTIME_SECRET_KEY';
const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_SECRET_NAME_LENGTH = 100;
const MAX_SECRET_VALUE_BYTES = 4096;
const SECRET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const AAD_PREFIX = 'herta.runtime-secret';

export type RuntimeSecretErrorCode =
  | 'missing_master_key'
  | 'invalid_master_key'
  | 'invalid_secret_name'
  | 'invalid_secret_value'
  | 'decrypt_failed';

export class RuntimeSecretError extends Error {
  readonly code: RuntimeSecretErrorCode;

  constructor(code: RuntimeSecretErrorCode) {
    super(`Runtime secret operation failed: ${code}`);
    this.name = 'RuntimeSecretError';
    this.code = code;
  }
}

export interface RuntimeSecretCiphertext {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export interface RuntimeSecretStatus {
  configured: boolean;
  updatedAt: Date | null;
  keyVersion: number | null;
}

export function resolveRuntimeSecretMasterKey(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const raw = env[RUNTIME_SECRET_MASTER_KEY_ENV]?.trim();
  if (!raw) throw new RuntimeSecretError('missing_master_key');

  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
      throw new RuntimeSecretError('invalid_master_key');
    }
    key = Buffer.from(raw, 'base64');
  }

  if (key.byteLength !== AES_KEY_BYTES) {
    key.fill(0);
    throw new RuntimeSecretError('invalid_master_key');
  }
  return key;
}

export function encryptRuntimeSecret(
  name: string,
  value: string,
  masterKey: Buffer,
): RuntimeSecretCiphertext {
  const normalizedName = validateRuntimeSecretName(name);
  const plaintext = validateRuntimeSecretValue(value);
  validateMasterKeyBuffer(masterKey);

  const iv = randomBytes(AES_GCM_IV_BYTES);
  const plaintextBytes = Buffer.from(plaintext, 'utf8');
  const aad = runtimeSecretAad(normalizedName, RUNTIME_SECRET_KEY_VERSION);
  try {
    const cipher = createCipheriv('aes-256-gcm', masterKey, iv, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag, keyVersion: RUNTIME_SECRET_KEY_VERSION };
  } finally {
    plaintextBytes.fill(0);
    aad.fill(0);
  }
}

export function decryptRuntimeSecret(
  name: string,
  encrypted: RuntimeSecretCiphertext,
  masterKey: Buffer,
): string {
  const normalizedName = validateRuntimeSecretName(name);
  validateMasterKeyBuffer(masterKey);
  if (
    encrypted.keyVersion !== RUNTIME_SECRET_KEY_VERSION ||
    encrypted.iv.byteLength !== AES_GCM_IV_BYTES ||
    encrypted.authTag.byteLength !== AES_GCM_TAG_BYTES ||
    encrypted.ciphertext.byteLength < 1 ||
    encrypted.ciphertext.byteLength > MAX_SECRET_VALUE_BYTES + AES_GCM_TAG_BYTES
  ) {
    throw new RuntimeSecretError('decrypt_failed');
  }

  const aad = runtimeSecretAad(normalizedName, encrypted.keyVersion);
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, encrypted.iv, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(encrypted.authTag);
    plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
    const decoded = plaintext.toString('utf8');
    validateRuntimeSecretValue(decoded);
    return decoded;
  } catch (error) {
    if (error instanceof RuntimeSecretError) throw error;
    throw new RuntimeSecretError('decrypt_failed');
  } finally {
    plaintext?.fill(0);
    aad.fill(0);
  }
}

export async function getRuntimeSecretStatus(
  prisma: PrismaClient,
  name: string,
): Promise<RuntimeSecretStatus> {
  const normalizedName = validateRuntimeSecretName(name);
  const record = await prisma.runtimeSecret.findUnique({
    where: { name: normalizedName },
    select: { updatedAt: true, keyVersion: true },
  });
  if (!record) return { configured: false, updatedAt: null, keyVersion: null };
  return { configured: true, updatedAt: record.updatedAt, keyVersion: record.keyVersion };
}

export async function setRuntimeSecret(
  prisma: PrismaClient,
  input: {
    name: string;
    value: string;
    updatedBy: string;
    env?: Record<string, string | undefined>;
  },
): Promise<RuntimeSecretStatus> {
  const name = validateRuntimeSecretName(input.name);
  const value = validateRuntimeSecretValue(input.value);
  const updatedBy = input.updatedBy.trim();
  if (!updatedBy || updatedBy.length > 128) throw new RuntimeSecretError('invalid_secret_value');

  const masterKey = resolveRuntimeSecretMasterKey(input.env);
  try {
    const encrypted = encryptRuntimeSecret(name, value, masterKey);
    const record = await prisma.runtimeSecret.upsert({
      where: { name },
      create: {
        name,
        ciphertext: Uint8Array.from(encrypted.ciphertext),
        iv: Uint8Array.from(encrypted.iv),
        authTag: Uint8Array.from(encrypted.authTag),
        keyVersion: encrypted.keyVersion,
        updatedBy,
      },
      update: {
        ciphertext: Uint8Array.from(encrypted.ciphertext),
        iv: Uint8Array.from(encrypted.iv),
        authTag: Uint8Array.from(encrypted.authTag),
        keyVersion: encrypted.keyVersion,
        updatedBy,
      },
      select: { updatedAt: true, keyVersion: true },
    });
    return { configured: true, updatedAt: record.updatedAt, keyVersion: record.keyVersion };
  } finally {
    masterKey.fill(0);
  }
}

export async function deleteRuntimeSecret(prisma: PrismaClient, name: string): Promise<void> {
  const normalizedName = validateRuntimeSecretName(name);
  await prisma.runtimeSecret.deleteMany({ where: { name: normalizedName } });
}

export async function readRuntimeSecret(
  prisma: PrismaClient,
  name: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const normalizedName = validateRuntimeSecretName(name);
  const record = await prisma.runtimeSecret.findUnique({ where: { name: normalizedName } });
  const masterKey = resolveRuntimeSecretMasterKey(env);
  try {
    if (!record) return null;
    return decryptRuntimeSecret(
      normalizedName,
      {
        ciphertext: Buffer.from(record.ciphertext),
        iv: Buffer.from(record.iv),
        authTag: Buffer.from(record.authTag),
        keyVersion: record.keyVersion,
      },
      masterKey,
    );
  } finally {
    masterKey.fill(0);
  }
}

export function validateRuntimeSecretName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > MAX_SECRET_NAME_LENGTH ||
    !SECRET_NAME_PATTERN.test(normalized)
  ) {
    throw new RuntimeSecretError('invalid_secret_name');
  }
  return normalized;
}

export function validateRuntimeSecretValue(value: string): string {
  if (typeof value !== 'string') throw new RuntimeSecretError('invalid_secret_value');
  const normalized = value.trim();
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (!normalized || bytes > MAX_SECRET_VALUE_BYTES || /[\u0000\r\n]/.test(normalized)) {
    throw new RuntimeSecretError('invalid_secret_value');
  }
  return normalized;
}

function validateMasterKeyBuffer(masterKey: Buffer): void {
  if (masterKey.byteLength !== AES_KEY_BYTES) throw new RuntimeSecretError('invalid_master_key');
}

function runtimeSecretAad(name: string, keyVersion: number): Buffer {
  return Buffer.from(`${AAD_PREFIX}:v${keyVersion}:${name}`, 'utf8');
}
