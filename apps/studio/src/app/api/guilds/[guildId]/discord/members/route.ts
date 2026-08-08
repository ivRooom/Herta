import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { searchGuildMembers } from '@/lib/bot-guild-members';
import { authorizeGuild } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const url = new URL(request.url);
  const query = url.searchParams.get('query')?.trim().slice(0, 64) ?? '';
  if (!/^\d{17,20}$/u.test(query) && query.length < 2) {
    return NextResponse.json({ error: '2文字以上入力してください' }, { status: 400 });
  }

  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, requestedLimit)) : 20;
  const members = await searchGuildMembers(guildId, query, limit);
  if (!members) {
    return NextResponse.json(
      { error: 'Discordメンバー候補を取得できませんでした' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { members },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
