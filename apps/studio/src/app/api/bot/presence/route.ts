import { NextResponse } from 'next/server';
import { parseBotPresenceConfig } from '@herta/shared';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readJsonBodyWithLimit } from '@/lib/bounded-request-body';
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

  let body: unknown;
  try {
    body = await readJsonBodyWithLimit(request, 4_096);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'リクエストサイズが大きすぎます' }, { status: 413 });
    }
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }

  const config = parseBotPresenceConfig(body);
  if (!config) {
    return NextResponse.json(
      {
        error: 'status / activityType / activityTextを確認してください。Activityは1〜128文字です',
      },
      { status: 400 },
    );
  }

  try {
    const result = await saveBotPresence(config, session.user.id);
    console.info('Bot Presence設定を更新しました', {
      status: config.status,
      activityType: config.activityType,
      subscriberCount: result.subscriberCount,
    });
    return NextResponse.json({
      config,
      persisted: result.persisted,
      notificationDelivered: result.subscriberCount > 0,
    });
  } catch (error) {
    console.error('Bot Presence設定の保存に失敗しました', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Presence設定を保存できませんでした' }, { status: 503 });
  }
}

async function isHertaAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin ?? false;
}
