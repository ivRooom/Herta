import { NextResponse } from 'next/server';
import {
  listDeliveryHistory,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  try {
    const deliveries = await listDeliveryHistory(
      prisma as unknown as DailyContentPrismaClient,
      guildId,
      limit,
    );
    return NextResponse.json(deliveries);
  } catch (error) {
    console.error('Daily Content delivery history request failed', error);
    return NextResponse.json({ error: '配信履歴の取得に失敗しました' }, { status: 500 });
  }
}

function parseLimit(value: string | null): number {
  if (!value) return 50;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}
