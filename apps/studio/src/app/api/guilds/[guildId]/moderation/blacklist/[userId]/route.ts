import { NextResponse } from 'next/server';
import {
  setModerationBlacklistEntryActive,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { authorizeGuild } from '@/lib/guild-plugins';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ guildId: string; userId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { guildId, userId } = await params;
  if (!/^\d+$/.test(userId)) {
    return NextResponse.json({ error: 'ユーザーIDが不正です' }, { status: 400 });
  }
  const authorization = await authorizeGuild(guildId, session.user.id);
  if (authorization.response) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストJSONが不正です' }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'activeをbooleanで指定してください' }, { status: 400 });
  }

  try {
    const entry = await setModerationBlacklistEntryActive(
      prisma as unknown as ModerationPrismaClient,
      {
        guildId,
        userId,
        active: body.active,
        actorId: session.user.id,
      },
    );
    if (!entry) {
      return NextResponse.json({ error: 'ブラックリスト登録が見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ entry });
  } catch (error) {
    console.error('Moderation blacklist update failed', error);
    return NextResponse.json({ error: 'ブラックリスト更新に失敗しました' }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
