import { NextResponse } from 'next/server';
import {
  DailyContentValidationError,
  deleteDailyContent,
  getDailyContent,
  normalizeDailyContentConfig,
  updateDailyContent,
  type DailyContentInput,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';
import { normalizeMessageStudioRequestBody } from '@/lib/message-studio-request';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; scheduleId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, scheduleId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const schedule = await getDailyContent(
      prisma as unknown as DailyContentPrismaClient,
      guildId,
      scheduleId,
    );
    if (!schedule) {
      return NextResponse.json({ error: 'Message Studio投稿が見つかりません' }, { status: 404 });
    }
    return NextResponse.json(schedule);
  } catch (error) {
    return messageStudioErrorResponse(error, 'Message Studio投稿の取得に失敗しました');
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, scheduleId } = await params;
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
    const plugin = await getGuildPlugin(guildId, 'daily-content');
    const config = normalizeDailyContentConfig(plugin?.config);
    const normalizedBody = normalizeMessageStudioRequestBody(body, config.defaultTimezone);
    const schedule = await updateDailyContent(prisma as unknown as DailyContentPrismaClient, {
      guildId,
      scheduleId,
      actorId: session.user.id,
      config,
      patch: normalizedBody as Partial<DailyContentInput>,
    });
    if (!schedule) {
      return NextResponse.json({ error: 'Message Studio投稿が見つかりません' }, { status: 404 });
    }
    return NextResponse.json(schedule);
  } catch (error) {
    return messageStudioErrorResponse(error, 'Message Studio投稿の更新に失敗しました');
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, scheduleId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const deleted = await deleteDailyContent(prisma as unknown as DailyContentPrismaClient, {
      guildId,
      scheduleId,
      actorId: session.user.id,
    });
    if (!deleted) {
      return NextResponse.json({ error: 'Message Studio投稿が見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return messageStudioErrorResponse(error, 'Message Studio投稿の削除に失敗しました');
  }
}

function messageStudioErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof DailyContentValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Message Studio schedule API request failed', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
