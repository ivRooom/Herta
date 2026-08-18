import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { BotForumThreadsError, getArchivedForumThreads } from '@/lib/bot-forum-threads';
import { authorizeGuild } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; forumId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, forumId } = await params;
  if (!/^\d{17,20}$/u.test(guildId) || !/^\d{17,20}$/u.test(forumId)) {
    return NextResponse.json({ error: 'GuildまたはForum IDが不正です' }, { status: 400 });
  }

  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const requestUrl = new URL(request.url);
  const before = requestUrl.searchParams.get('before')?.trim() || null;
  if (before && (before.length > 64 || !Number.isFinite(Date.parse(before)))) {
    return NextResponse.json({ error: 'ページングcursorが不正です' }, { status: 400 });
  }
  const rawLimit = Number.parseInt(requestUrl.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 50;

  try {
    const page = await getArchivedForumThreads(guildId, forumId, before, limit);
    return NextResponse.json(page, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof BotForumThreadsError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 503;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('Archived Forum Thread Catalog proxy failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      guildId,
      forumId,
    });
    return NextResponse.json({ error: 'Forumの過去投稿を取得できませんでした' }, { status: 500 });
  }
}
