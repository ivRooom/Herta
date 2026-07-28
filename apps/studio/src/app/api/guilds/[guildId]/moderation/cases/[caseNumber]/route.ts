import { NextResponse } from 'next/server';
import {
  getModerationCase,
  ModerationValidationError,
  normalizeModerationConfig,
  normalizeModerationReason,
  updateModerationCase,
  type ModerationCaseStatus,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; caseNumber: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, caseNumber: caseNumberInput } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const moderationCase = await getModerationCase(
      prisma as unknown as ModerationPrismaClient,
      guildId,
      parseCaseNumber(caseNumberInput),
    );
    if (!moderationCase) {
      return NextResponse.json({ error: 'ケースが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(moderationCase);
  } catch (error) {
    return moderationErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, caseNumber: caseNumberInput } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: '更新内容が不正です' }, { status: 400 });
  }

  try {
    const plugin = await getGuildPlugin(guildId, 'moderation');
    const config = normalizeModerationConfig(plugin?.config);
    const reason = 'reason' in body ? normalizeModerationReason(body.reason, config) : undefined;
    const status = 'status' in body ? parseStatus(body.status) : undefined;
    const moderationCase = await updateModerationCase(prisma as unknown as ModerationPrismaClient, {
      guildId,
      caseNumber: parseCaseNumber(caseNumberInput),
      actorId: session.user.id,
      source: 'dashboard',
      reason,
      status,
    });
    if (!moderationCase) {
      return NextResponse.json({ error: 'ケースが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(moderationCase);
  } catch (error) {
    return moderationErrorResponse(error);
  }
}

function parseCaseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ModerationValidationError('ケース番号は1以上の整数で指定してください');
  }
  return parsed;
}

function parseStatus(value: unknown): ModerationCaseStatus {
  if (value === 'active' || value === 'completed' || value === 'revoked' || value === 'failed') {
    return value;
  }
  throw new ModerationValidationError('ケース状態が不正です');
}

function moderationErrorResponse(error: unknown): NextResponse {
  if (error instanceof ModerationValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Moderation case API request failed', error);
  return NextResponse.json({ error: 'モデレーションケースの処理に失敗しました' }, { status: 500 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
