import { NextResponse } from 'next/server';
import {
  AI_RUNTIME_CONFIGURATION,
  OPENAI_API_KEY_RUNTIME_SECRET,
  RuntimeConfigurationError,
  readRuntimeSecret,
  setRuntimeConfiguration,
} from '@herta/db';
import { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import {
  AiRuntimePolicyError,
  getAiRuntimePolicyMetadata,
  parseAiRuntimeStoredValue,
  resolveAiRuntimeSelection,
} from '@herta/plugin-catalog/ai-runtime-policy';
import { auth } from '@/auth';
import {
  resolveOpenAiProviderCredentialAvailability,
  type AiProviderCredentialAvailability,
} from '@/lib/ai-provider-credential-availability';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { isStudioPlatformAdmin } from '@/lib/studio-platform-admin';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BODY_BYTES = 4 * 1024;

type AiRuntimePolicyMetadata = ReturnType<typeof getAiRuntimePolicyMetadata>;

type ProviderPolicyView = {
  policy: AiRuntimePolicyMetadata;
  providerAvailability: AiProviderCredentialAvailability[];
};

export async function GET() {
  const userId = await authorizedAdminUserId();
  if ('response' in userId) return userId.response;

  const resolver = new AiRuntimeConfigurationResolver({ prisma, ttlMs: 0 });
  try {
    const [runtime, providerView] = await Promise.all([
      resolver.resolve(),
      resolveProviderPolicyView(),
    ]);
    return noStoreJson({
      current: runtime.value,
      resolved: runtime.selection,
      source: runtime.source,
      storeAvailable: runtime.storeAvailable,
      updatedAt: runtime.updatedAt?.toISOString() ?? null,
      providerAvailability: providerView.providerAvailability,
      policy: providerView.policy,
    });
  } catch {
    return noStoreJson(
      {
        error: '保存済みAI Runtime Settingsがserver policyと一致しません',
        policy: [],
      },
      503,
    );
  }
}

export async function PUT(request: Request) {
  const userId = await authorizedAdminUserId();
  if ('response' in userId) return userId.response;
  if (!isSameOriginMutationRequest(request)) {
    return noStoreJson({ error: '不正なリクエスト元です' }, 403);
  }

  const body = await parseRuntimeSettingsBody(request);
  if ('response' in body) return body.response;

  const providerView = await resolveProviderPolicyView();
  const availability = providerView.providerAvailability.find(
    (entry) => entry.provider === body.value.provider,
  );
  if (!availability?.available) {
    const missingCredential = availability?.status === 'missing_credential';
    return noStoreJson(
      {
        error: missingCredential
          ? '選択したAI Providerのcredentialが設定されていません'
          : 'AI Providerのcredential状態を確認できません',
        providerAvailability: providerView.providerAvailability,
        policy: providerView.policy,
      },
      missingCredential ? 409 : 503,
    );
  }

  try {
    const stored = await setRuntimeConfiguration(prisma, {
      name: AI_RUNTIME_CONFIGURATION,
      value: { ...body.value },
      updatedBy: userId.userId,
    });
    return noStoreJson({
      current: body.value,
      resolved: resolveAiRuntimeSelection(body.value),
      source: 'console',
      storeAvailable: true,
      updatedAt: stored.updatedAt.toISOString(),
      providerAvailability: providerView.providerAvailability,
      policy: providerView.policy,
    });
  } catch (error) {
    if (error instanceof RuntimeConfigurationError || error instanceof AiRuntimePolicyError) {
      return noStoreJson({ error: 'AI Runtime Settingsの値が不正です' }, 400);
    }
    return noStoreJson({ error: 'AI Runtime Settingsを保存できませんでした' }, 500);
  }
}

async function resolveProviderPolicyView(): Promise<ProviderPolicyView> {
  const openAiAvailability = await resolveOpenAiProviderCredentialAvailability({
    readRuntimeCredential: () =>
      readRuntimeSecret(prisma, OPENAI_API_KEY_RUNTIME_SECRET, process.env),
    environmentCredential: process.env.OPENAI_API_KEY,
  });
  const providerAvailability = [openAiAvailability];
  const availableProviders = new Set(
    providerAvailability.filter((entry) => entry.available).map((entry) => entry.provider),
  );

  return {
    providerAvailability,
    policy: getAiRuntimePolicyMetadata().filter((entry) => availableProviders.has(entry.provider)),
  };
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

async function parseRuntimeSettingsBody(
  request: Request,
): Promise<{ value: ReturnType<typeof parseAiRuntimeStoredValue> } | { response: NextResponse }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_REQUEST_BODY_BYTES);
    const decoded = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    return { value: parseAiRuntimeStoredValue(decoded) };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { response: noStoreJson({ error: '入力内容が大きすぎます' }, 413) };
    }
    if (error instanceof AiRuntimePolicyError) {
      return { response: noStoreJson({ error: 'AI Runtime Settingsの値が不正です' }, 400) };
    }
    return { response: noStoreJson({ error: 'JSON body が不正です' }, 400) };
  }
}

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
