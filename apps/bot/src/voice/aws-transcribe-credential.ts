import {
  AWS_TRANSCRIBE_ACCESS_KEY_ID_RUNTIME_SECRET,
  AWS_TRANSCRIBE_SECRET_ACCESS_KEY_RUNTIME_SECRET,
  RuntimeSecretError,
  readRuntimeSecret,
  type PrismaClient,
} from '@herta/db';

export interface AwsTranscribeCredential {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/**
 * Runtime Secret Storeを最優先し、まだ設定が無い場合だけenv fallbackを使う
 * (apps/bot/src/ai/factory.tsのresolveAiOpenAiCredentialと同じfail-closedパターン)。
 * Access Key ID/Secret Access Keyのどちらか一方だけが設定されている状態は不正とみなしnullを返す。
 */
export async function resolveAwsTranscribeCredential(
  prisma: PrismaClient,
  env: Record<string, string | undefined> = process.env,
  readSecret: typeof readRuntimeSecret = readRuntimeSecret,
): Promise<AwsTranscribeCredential | null> {
  let accessKeyId: string | null;
  let secretAccessKey: string | null;
  try {
    accessKeyId = await readSecret(prisma, AWS_TRANSCRIBE_ACCESS_KEY_ID_RUNTIME_SECRET, env);
    secretAccessKey = await readSecret(
      prisma,
      AWS_TRANSCRIBE_SECRET_ACCESS_KEY_RUNTIME_SECRET,
      env,
    );
  } catch (error) {
    if (error instanceof RuntimeSecretError) return null;
    throw error;
  }

  accessKeyId ??= env['AWS_TRANSCRIBE_ACCESS_KEY_ID']?.trim() || null;
  secretAccessKey ??= env['AWS_TRANSCRIBE_SECRET_ACCESS_KEY']?.trim() || null;
  const region = env['AWS_TRANSCRIBE_REGION']?.trim() || env['AWS_REGION']?.trim() || null;

  if (!accessKeyId || !secretAccessKey || !region) return null;
  return { accessKeyId, secretAccessKey, region };
}
