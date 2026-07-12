import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuilds } from '@/lib/guilds';

export const dynamic = 'force-dynamic';

/** GET /api/guilds — ログインユーザーが管理可能な Guild 一覧を返す */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const accessToken = await getDiscordAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Discord の再ログインが必要です' }, { status: 401 });
  }

  try {
    const guilds = await getManageableGuilds(accessToken);
    return NextResponse.json({ guilds });
  } catch {
    return NextResponse.json({ error: 'Guild 一覧の取得に失敗しました' }, { status: 502 });
  }
}
