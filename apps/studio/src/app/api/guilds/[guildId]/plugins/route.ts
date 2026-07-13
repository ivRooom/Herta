import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { authorizeGuild, listGuildPlugins } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  return NextResponse.json({ plugins: await listGuildPlugins(guildId) });
}
