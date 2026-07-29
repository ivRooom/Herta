import { NextResponse } from 'next/server';
import {
  DailyContentValidationError,
  retryDailyContentDelivery,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; deliveryId: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, deliveryId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const delivery = await retryDailyContentDelivery(
      prisma as unknown as DailyContentPrismaClient,
      {
        guildId,
        deliveryId,
        actorId: session.user.id,
      },
    );
    if (!delivery) {
      return NextResponse.json({ error: '配信履歴が見つかりません' }, { status: 404 });
    }
    return NextResponse.json(delivery);
  } catch (error) {
    if (error instanceof DailyContentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Daily Content retry request failed', error);
    return NextResponse.json({ error: '配信の再実行予約に失敗しました' }, { status: 500 });
  }
}
