import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';

export const dynamic = 'force-dynamic';

/**
 * GET /api/guilds/[guildId] — 選択された Guild を返す。
 * ログインユーザーが管理権限を持たない Guild は 403 を返す。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const accessToken = await getDiscordAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'Discord の再ログインが必要です' }, { status: 401 });
  }

  const { guildId } = await params;

  try {
    const guild = await getManageableGuild(accessToken, guildId);
    if (!guild) {
      return NextResponse.json({ error: 'この Guild を管理する権限がありません' }, { status: 403 });
    }

    await persistSelectedGuild(guild, session.user.id);
    return NextResponse.json({ guild });
  } catch {
    return NextResponse.json({ error: 'Guild 情報の取得に失敗しました' }, { status: 502 });
  }
}
