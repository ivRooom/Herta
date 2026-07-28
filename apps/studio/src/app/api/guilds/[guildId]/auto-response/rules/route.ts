import { NextResponse } from 'next/server';
import {
  AutoResponseValidationError,
  createAutoResponseRule,
  listAutoResponseRules,
  normalizeAutoResponseConfig,
  type AutoResponseMatchMode,
  type AutoResponsePrismaClient,
  type AutoResponseResponseType,
  type AutoResponseRuleInput,
} from '@herta/plugin-catalog/auto-response-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const url = new URL(request.url);
  try {
    const result = await listAutoResponseRules(prisma as unknown as AutoResponsePrismaClient, {
      guildId,
      page: parsePositiveInteger(url.searchParams.get('page')),
      pageSize: parsePositiveInteger(url.searchParams.get('pageSize')),
      search: url.searchParams.get('search') ?? undefined,
      matchMode: parseMatchMode(url.searchParams.get('matchMode')),
      responseType: parseResponseType(url.searchParams.get('responseType')),
      enabled: parseOptionalBoolean(url.searchParams.get('enabled')),
    });
    return NextResponse.json(result);
  } catch (error) {
    return autoResponseErrorResponse(error, '自動応答ルールの取得に失敗しました');
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON bodyが不正です' }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'ルール内容が不正です' }, { status: 400 });
  }

  try {
    const plugin = await getGuildPlugin(guildId, 'auto-response');
    const config = normalizeAutoResponseConfig(plugin?.config);
    const rule = await createAutoResponseRule(prisma as unknown as AutoResponsePrismaClient, {
      guildId,
      actorId: session.user.id,
      source: 'dashboard',
      config,
      rule: body as unknown as AutoResponseRuleInput,
    });
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return autoResponseErrorResponse(error, '自動応答ルールの作成に失敗しました');
  }
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseMatchMode(value: string | null): AutoResponseMatchMode | undefined {
  return value === 'exact' || value === 'partial' || value === 'prefix' || value === 'regex'
    ? value
    : undefined;
}

function parseResponseType(value: string | null): AutoResponseResponseType | undefined {
  return value === 'text' || value === 'embed' ? value : undefined;
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function autoResponseErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof AutoResponseValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Auto Response API request failed', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
