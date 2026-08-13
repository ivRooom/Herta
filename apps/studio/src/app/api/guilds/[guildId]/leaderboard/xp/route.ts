import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { authorizeGuild } from '@/lib/guild-plugins';
import { publishXpRoleReconciliationEvent } from '@/lib/plugin-runtime-events';
import {
  applyXpAdminOperation,
  getXpAdminGuildSummary,
  getXpAdminProfile,
  parseXpAdminRequest,
  XpAdminValidationError,
} from '@/lib/xp-admin';
import { requestXpRoleSweep } from '@/lib/xp-role-sweep';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const userId = new URL(request.url).searchParams.get('userId')?.trim() ?? '';
  try {
    const [summary, profile] = await Promise.all([
      getXpAdminGuildSummary(guildId),
      userId ? getXpAdminProfile(guildId, userId) : Promise.resolve(null),
    ]);
    return NextResponse.json(
      { summary, profile },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return xpAdminErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }

  const parsed = parseXpAdminRequest(body, guildId);
  if (!parsed) return NextResponse.json({ error: 'XP管理操作の入力が不正です' }, { status: 400 });

  try {
    const result = await applyXpAdminOperation({
      guildId,
      actorId: session.user.id,
      request: parsed,
    });

    const rewardRoleSyncPublished =
      result.rewardRoleSyncRequired && parsed.userId
        ? await publishXpRoleReconciliationEvent({ guildId, userId: parsed.userId })
        : false;
    const rewardRoleSweep =
      parsed.action === 'reset_guild'
        ? await requestXpRoleSweep({
            guildId,
            actorId: session.user.id,
            reason: 'xp_admin_reset_guild',
            note: parsed.reason,
          })
        : null;

    const [summary, profile] = await Promise.all([
      getXpAdminGuildSummary(guildId),
      parsed.userId ? getXpAdminProfile(guildId, parsed.userId) : Promise.resolve(null),
    ]);
    return NextResponse.json({
      result,
      rewardRoleSyncPublished,
      rewardRoleSweep,
      summary,
      profile,
    });
  } catch (error) {
    return xpAdminErrorResponse(error);
  }
}

function xpAdminErrorResponse(error: unknown): NextResponse {
  if (error instanceof XpAdminValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Leaderboard XP admin API request failed', error);
  return NextResponse.json({ error: 'XP管理操作に失敗しました' }, { status: 500 });
}
