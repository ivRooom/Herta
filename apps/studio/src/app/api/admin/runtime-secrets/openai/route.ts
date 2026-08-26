import { NextResponse } from 'next/server';
import {
  deleteRuntimeSecret,
  getRuntimeSecretStatus,
  OPENAI_API_KEY_RUNTIME_SECRET,
  RuntimeSecretError,
  setRuntimeSecret,
} from '@herta/db';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { isStudioPlatformAdmin } from '@/lib/studio-platform-admin';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const MAX_OPENAI_API_KEY_CHARS = 4096;

type OpenAiCredentialBody = { apiKey: string };

export async function GET() {
  const userId = await authorizedAdminUserId();
  if ('response' in userId) return userId.response;

  const status = await getRuntimeSecretStatus(prisma, OPENAI_API_KEY_RUNTIME_SECRET);
  return noStoreJson({
    provider: 'openai',
    configured: status.configured,
    environmentFallbackConfigured: hasOpenAiEnvironmentFallback(),
    updatedAt: status.updatedAt?.toISOString() ?? null,
    keyVersion: status.keyVersion,
  });
}

export async function PUT(request: Request) {
  const userId = await authorizedAdminUserId();
  if ('response' in userId) return userId.response;
  if (!isSameOriginMutationRequest(request)) {
    return noStoreJson({ error: '不正なリクエスト元です' }, 403);
  }

  const body = await parseCredentialBody(request);
  if ('response' in body) return body.response;

  try {
    const status = await setRuntimeSecret(prisma, {
      name: OPENAI_API_KEY_RUNTIME_SECRET,
      value: body.value.apiKey,
      updatedBy: userId.userId,
    });
    return noStoreJson({
      provider: 'openai',
      configured: true,
      environmentFallbackConfigured: hasOpenAiEnvironmentFallback(),
      updatedAt: status.updatedAt?.toISOString() ?? null,
      keyVersion: status.keyVersion,
    });
  } catch (error) {
    return runtimeSecretFailureResponse(error);
  }
}

export async function DELETE(request: Request) {
  const userId = await authorizedAdminUserId();
  if ('response' in userId) return userId.response;
  if (!isSameOriginMutationRequest(request)) {
    return noStoreJson({ error: '不正なリクエスト元です' }, 403);
  }

  await deleteRuntimeSecret(prisma, OPENAI_API_KEY_RUNTIME_SECRET);
  return noStoreJson({
    provider: 'openai',
    configured: false,
    environmentFallbackConfigured: hasOpenAiEnvironmentFallback(),
    updatedAt: null,
    keyVersion: null,
  });
}

async function authorizedAdminUserId(): Promise<{ userId: string } | { response: NextResponse }> {
  const session = await auth();
  const userId = session?.user?.id?.trim();
  if (!userId) return { response: noStoreJson({ error: '認証が必要です' }, 401) };
  if (!(await isStudioPlatformAdmin(userId))) {
    return { response: noStoreJson({ error: 'Herta管理者権限が必要です' }, 403) };
  }
  return { userId };
}

async function parseCredentialBody(
  request: Request,
): Promise<{ value: OpenAiCredentialBody } | { response: NextResponse }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_REQUEST_BODY_BYTES);
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (!isCredentialBody(value)) {
      return { response: noStoreJson({ error: 'OpenAI APIキーの入力が不正です' }, 400) };
    }
    return { value };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { response: noStoreJson({ error: '入力内容が大きすぎます' }, 413) };
    }
    return { response: noStoreJson({ error: 'JSON body が不正です' }, 400) };
  }
}

function isCredentialBody(value: unknown): value is OpenAiCredentialBody {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'apiKey')) return false;
  if (typeof value.apiKey !== 'string') return false;
  const apiKey = value.apiKey.trim();
  return (
    apiKey.length > 0 && apiKey.length <= MAX_OPENAI_API_KEY_CHARS && !/[\u0000\r\n]/.test(apiKey)
  );
}

function hasOpenAiEnvironmentFallback(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function runtimeSecretFailureResponse(error: unknown): NextResponse {
  if (error instanceof RuntimeSecretError) {
    if (error.code === 'missing_master_key' || error.code === 'invalid_master_key') {
      return noStoreJson({ error: 'Secret暗号化設定がまだ準備されていません' }, 503);
    }
    if (error.code === 'invalid_secret_name' || error.code === 'invalid_secret_value') {
      return noStoreJson({ error: 'OpenAI APIキーの入力が不正です' }, 400);
    }
  }
  return noStoreJson({ error: 'OpenAI APIキーを保存できませんでした' }, 500);
}

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
