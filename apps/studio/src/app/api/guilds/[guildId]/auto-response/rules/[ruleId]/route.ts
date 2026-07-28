import { NextResponse } from 'next/server';
import {
  AutoResponseValidationError,
  deleteAutoResponseRule,
  getAutoResponseRule,
  normalizeAutoResponseConfig,
  updateAutoResponseRule,
  type AutoResponsePrismaClient,
  type AutoResponseRuleInput,
} from '@herta/plugin-catalog/auto-response-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; ruleId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, ruleId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const rule = await getAutoResponseRule(
      prisma as unknown as AutoResponsePrismaClient,
      guildId,
      ruleId,
    );
    if (!rule) return NextResponse.json({ error: 'ルールが見つかりません' }, { status: 404 });
    return NextResponse.json(rule);
  } catch (error) {
    return autoResponseErrorResponse(error, '自動応答ルールの取得に失敗しました');
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, ruleId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON bodyが不正です' }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: '更新内容が不正です' }, { status: 400 });
  }

  try {
    const plugin = await getGuildPlugin(guildId, 'auto-response');
    const config = normalizeAutoResponseConfig(plugin?.config);
    const rule = await updateAutoResponseRule(prisma as unknown as AutoResponsePrismaClient, {
      guildId,
      ruleId,
      actorId: session.user.id,
      source: 'dashboard',
      config,
      patch: body as Partial<AutoResponseRuleInput>,
    });
    if (!rule) return NextResponse.json({ error: 'ルールが見つかりません' }, { status: 404 });
    return NextResponse.json(rule);
  } catch (error) {
    return autoResponseErrorResponse(error, '自動応答ルールの更新に失敗しました');
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, ruleId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const deleted = await deleteAutoResponseRule(prisma as unknown as AutoResponsePrismaClient, {
      guildId,
      ruleId,
      actorId: session.user.id,
      source: 'dashboard',
    });
    if (!deleted) return NextResponse.json({ error: 'ルールが見つかりません' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return autoResponseErrorResponse(error, '自動応答ルールの削除に失敗しました');
  }
}

function autoResponseErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof AutoResponseValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Auto Response rule API request failed', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
