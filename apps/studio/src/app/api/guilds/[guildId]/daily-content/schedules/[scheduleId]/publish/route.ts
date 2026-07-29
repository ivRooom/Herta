import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  reserveManualDelivery,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; scheduleId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, scheduleId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const requestId = request.headers.get('idempotency-key')?.trim() || randomUUID();
  try {
    const delivery = await reserveManualDelivery(prisma as unknown as DailyContentPrismaClient, {
      guildId,
      scheduleId,
      actorId: session.user.id,
      requestId,
    });
    if (!delivery) {
      return NextResponse.json({ error: 'Daily Contentが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(delivery, { status: 202 });
  } catch (error) {
    console.error('Daily Content manual publish request failed', error);
    return NextResponse.json({ error: '手動配信の予約に失敗しました' }, { status: 500 });
  }
}
