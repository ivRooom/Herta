import { RuntimeSecretError, type readRuntimeSecret } from '@herta/db';
import { describe, expect, it } from 'vitest';
import { resolveAwsTranscribeCredential } from './aws-transcribe-credential.js';

const prisma = {} as Parameters<typeof readRuntimeSecret>[0];

describe('resolveAwsTranscribeCredential', () => {
  it('Runtime Secret StoreとAWS_REGIONが揃っていれば認証情報を返す', async () => {
    const result = await resolveAwsTranscribeCredential(
      prisma,
      { AWS_REGION: 'ap-northeast-1' },
      async (_prisma, name) =>
        name === 'aws.transcribe_access_key_id' ? 'stored-key-id' : 'stored-secret',
    );
    expect(result).toEqual({
      accessKeyId: 'stored-key-id',
      secretAccessKey: 'stored-secret',
      region: 'ap-northeast-1',
    });
  });

  it('Runtime Secret未登録時だけenv fallbackを使う', async () => {
    const result = await resolveAwsTranscribeCredential(
      prisma,
      {
        AWS_TRANSCRIBE_ACCESS_KEY_ID: 'env-key-id',
        AWS_TRANSCRIBE_SECRET_ACCESS_KEY: 'env-secret',
        AWS_REGION: 'ap-northeast-1',
      },
      async () => null,
    );
    expect(result).toEqual({
      accessKeyId: 'env-key-id',
      secretAccessKey: 'env-secret',
      region: 'ap-northeast-1',
    });
  });

  it('AWS_TRANSCRIBE_REGIONが指定されていればAWS_REGIONより優先する', async () => {
    const result = await resolveAwsTranscribeCredential(
      prisma,
      {
        AWS_TRANSCRIBE_REGION: 'us-east-1',
        AWS_REGION: 'ap-northeast-1',
      },
      async () => 'stored',
    );
    expect(result?.region).toBe('us-east-1');
  });

  it('Access Key IDだけ設定されている不完全な状態はnullを返す', async () => {
    const result = await resolveAwsTranscribeCredential(
      prisma,
      { AWS_REGION: 'ap-northeast-1' },
      async (_prisma, name) => (name === 'aws.transcribe_access_key_id' ? 'only-key-id' : null),
    );
    expect(result).toBeNull();
  });

  it('regionが未設定ならnullを返す', async () => {
    const result = await resolveAwsTranscribeCredential(prisma, {}, async () => 'stored');
    expect(result).toBeNull();
  });

  it('Runtime Secret Storeのread失敗はenv fallbackへ逃がさずfail closedする', async () => {
    const result = await resolveAwsTranscribeCredential(
      prisma,
      {
        AWS_TRANSCRIBE_ACCESS_KEY_ID: 'env-key-id',
        AWS_TRANSCRIBE_SECRET_ACCESS_KEY: 'env-secret',
        AWS_REGION: 'ap-northeast-1',
      },
      async () => {
        throw new RuntimeSecretError('decrypt_failed');
      },
    );
    expect(result).toBeNull();
  });
});
