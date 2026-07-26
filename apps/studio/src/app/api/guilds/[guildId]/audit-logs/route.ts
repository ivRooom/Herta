import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { authorizeGuild } from '@/lib/guild-plugins';
import { listGuildAuditLogs, parseAuditLogQuery } from '@/lib/audit-logs';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const query = parseAuditLogQuery(new URL(request.url).searchParams);
    const result = await listGuildAuditLogs(prisma, guildId, query);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Audit log API request failed', error);
    return NextResponse.json({ error: '監査ログの取得に失敗しました' }, { status: 500 });
  }
}
