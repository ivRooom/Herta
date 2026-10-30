import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { resolvePluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import { aggregateValorantStats } from '@/lib/valorant-stats';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  if (!/^\d{17,20}$/.test(guildId))
    return NextResponse.json({ error: 'Invalid guild' }, { status: 400 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です。' }, { status: 401 });
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;
  const permission = resolvePluginConfigStudioAccess(access.access, guildId, 'valorant', [
    'enabledAgents',
  ]);
  if (!permission.readableConfigPaths.includes('enabledAgents')) {
    return NextResponse.json({ error: 'VALORANT統計の閲覧権限がありません。' }, { status: 403 });
  }
  try {
    const draws = await prisma.valorantPickSession.findMany({
      where: { guildId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: 5001,
      select: {
        id: true,
        mode: true,
        mapId: true,
        completedAt: true,
        candidates: true,
        result: true,
      },
    });
    return NextResponse.json(
      {
        ...aggregateValorantStats(draws.slice(0, 5000)),
        truncated: draws.length > 5000,
        retentionDays: 90,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('VALORANT stats query failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: '統計を取得できません。' }, { status: 503 });
  }
}
