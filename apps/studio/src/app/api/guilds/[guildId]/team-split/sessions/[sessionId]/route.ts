import { NextResponse } from 'next/server';
import {
  closeTeamSplitSession,
  getTeamSplitSession,
  joinTeamSplitSession,
  listTeamSplitParticipants,
  removeTeamSplitParticipant,
  rerollTeamSplitSession,
  splitTeamSplitSession,
  type TeamSplitPrismaClient,
} from '@herta/plugin-catalog/team-split-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild } from '@/lib/guild-plugins';
import { toPublicTeamSplitSession } from '@/lib/team-split';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; sessionId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const authSession = await auth();
  if (!authSession?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { guildId, sessionId } = await params;
  const authorization = await authorizeGuild(guildId, authSession.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const [session, participants] = await Promise.all([
      getTeamSplitSession(prisma as unknown as TeamSplitPrismaClient, guildId, sessionId),
      listTeamSplitParticipants(prisma as unknown as TeamSplitPrismaClient, guildId, sessionId),
    ]);
    if (!session) {
      return NextResponse.json({ error: 'セッションが見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ session: toPublicTeamSplitSession(session), participants });
  } catch (error) {
    console.error('Team Split detail API request failed', safeErrorName(error));
    return NextResponse.json(
      { error: 'Team Splitセッションの取得に失敗しました' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const authSession = await auth();
  if (!authSession?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { guildId, sessionId } = await params;
  const authorization = await authorizeGuild(guildId, authSession.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON bodyが不正です' }, { status: 400 });
  }
  if (!isRecord(body) || typeof body['action'] !== 'string') {
    return NextResponse.json({ error: 'actionを指定してください' }, { status: 400 });
  }

  try {
    const common = {
      guildId,
      sessionId,
      actorId: authSession.user.id,
      force: true,
    };
    const action = body['action'];
    if (action === 'split' || action === 'reroll' || action === 'close') {
      const result =
        action === 'split'
          ? await splitTeamSplitSession(prisma as unknown as TeamSplitPrismaClient, common)
          : action === 'reroll'
            ? await rerollTeamSplitSession(prisma as unknown as TeamSplitPrismaClient, common)
            : await closeTeamSplitSession(prisma as unknown as TeamSplitPrismaClient, common);
      return actionResult(result);
    }

    const userId = typeof body['userId'] === 'string' ? body['userId'].trim() : '';
    if (!/^\d{17,20}$/.test(userId)) {
      return NextResponse.json(
        { error: '有効なDiscordユーザーIDを指定してください' },
        { status: 400 },
      );
    }
    if (action === 'add') {
      const result = await joinTeamSplitSession(prisma as unknown as TeamSplitPrismaClient, {
        guildId,
        sessionId,
        userId,
        actorId: authSession.user.id,
        score: typeof body['score'] === 'number' ? body['score'] : 0,
      });
      if (result.state === 'not_found') {
        return NextResponse.json({ error: 'セッションが見つかりません' }, { status: 404 });
      }
      if (result.state === 'full') {
        return NextResponse.json({ error: 'セッションは満員です' }, { status: 409 });
      }
      if (result.state === 'locked') {
        return NextResponse.json(
          { error: '現在の状態では参加者を変更できません' },
          { status: 409 },
        );
      }
      return NextResponse.json(toPublicTeamSplitSession(result.session));
    }
    if (action === 'remove') {
      const result = await removeTeamSplitParticipant(prisma as unknown as TeamSplitPrismaClient, {
        guildId,
        sessionId,
        targetUserId: userId,
        actorId: authSession.user.id,
        force: true,
      });
      if (result.state === 'not_found') {
        return NextResponse.json({ error: 'セッションが見つかりません' }, { status: 404 });
      }
      if (result.state === 'creator_must_close') {
        return NextResponse.json({ error: '作成者は削除できません' }, { status: 409 });
      }
      if (result.state === 'not_joined') {
        return NextResponse.json({ error: '対象ユーザーは参加していません' }, { status: 409 });
      }
      if (result.state === 'locked') {
        return NextResponse.json(
          { error: '現在の状態では参加者を変更できません' },
          { status: 409 },
        );
      }
      if (result.state === 'forbidden') {
        return NextResponse.json({ error: '操作権限がありません' }, { status: 403 });
      }
      return NextResponse.json(toPublicTeamSplitSession(result.session));
    }

    return NextResponse.json({ error: '未対応のactionです' }, { status: 400 });
  } catch (error) {
    console.error('Team Split update API request failed', safeErrorName(error));
    return NextResponse.json(
      { error: 'Team Splitセッションの更新に失敗しました' },
      { status: 500 },
    );
  }
}

function actionResult(
  result:
    | Awaited<ReturnType<typeof splitTeamSplitSession>>
    | Awaited<ReturnType<typeof closeTeamSplitSession>>,
): NextResponse {
  if (result.state === 'not_found') {
    return NextResponse.json({ error: 'セッションが見つかりません' }, { status: 404 });
  }
  if (result.state === 'forbidden') {
    return NextResponse.json({ error: '操作権限がありません' }, { status: 403 });
  }
  if (result.state === 'not_enough_participants') {
    return NextResponse.json({ error: '参加者数がチーム数に達していません' }, { status: 409 });
  }
  if (result.state === 'invalid_state') {
    return NextResponse.json({ error: '現在の状態では操作できません' }, { status: 409 });
  }
  return NextResponse.json(toPublicTeamSplitSession(result.session));
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 120) : 'UnknownError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
