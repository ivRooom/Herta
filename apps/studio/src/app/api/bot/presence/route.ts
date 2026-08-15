import { NextResponse } from 'next/server';
import { parseBotPresenceConfig } from '@herta/shared';
import { auth } from '@/auth';
import { getStoredBotPresence, saveBotPresence } from '@/lib/bot-presence-store';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!(await isHertaAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Herta管理者権限が必要です' }, { status: 403 });
  }

  const state = await getStoredBotPresence();
  return NextResponse.json(state);
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  if (!(await isHertaAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Herta管理者権限が必要です' }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return NextResponse.json({ error: 'リクエストサイズが大きすぎます' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }

  const config = parseBotPresenceConfig(body);
  if (!config) {
    return NextResponse.json(
      {
        error:
          'status / activityType / activityTextを確認してください。Activityは1〜128文字です',
      },
      { status: 400 },
    );
  }

  try {
    const result = await saveBotPresence(config);
    if (!result.persisted) {
      return NextResponse.json(
        { error: 'Redisが設定されていないためPresenceを保存できません' },
        { status: 503 },
      );
    }

    console.info('Bot Presence設定を更新しました', {
      actorId: session.user.id,
      status: config.status,
      activityType: config.activityType,
      subscriberCount: result.subscriberCount,
    });
    return NextResponse.json({
      config,
      persisted: true,
      appliedImmediately: result.subscriberCount > 0,
    });
  } catch (error) {
    console.error('Bot Presence設定の保存に失敗しました', {
      actorId: session.user.id,
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Presence設定を保存できませんでした' }, { status: 503 });
  }
}

async function isHertaAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin ?? false;
}
