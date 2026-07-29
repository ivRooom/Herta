import { NextResponse } from 'next/server';
import {
  DailyContentValidationError,
  createDailyContent,
  listDailyContents,
  normalizeDailyContentConfig,
  type DailyContentInput,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const schedules = await listDailyContents(
      prisma as unknown as DailyContentPrismaClient,
      guildId,
    );
    return NextResponse.json(schedules);
  } catch (error) {
    return dailyContentErrorResponse(error, 'Daily Contentの取得に失敗しました');
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
    return NextResponse.json({ error: 'スケジュール内容が不正です' }, { status: 400 });
  }

  try {
    const plugin = await getGuildPlugin(guildId, 'daily-content');
    const config = normalizeDailyContentConfig(plugin?.config);
    const schedule = await createDailyContent(prisma as unknown as DailyContentPrismaClient, {
      guildId,
      actorId: session.user.id,
      config,
      schedule: body as unknown as DailyContentInput,
    });
    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    return dailyContentErrorResponse(error, 'Daily Contentの作成に失敗しました');
  }
}

function dailyContentErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof DailyContentValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Daily Content schedules API request failed', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
