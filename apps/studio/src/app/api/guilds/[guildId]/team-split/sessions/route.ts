import { NextResponse } from 'next/server';
import {
  TeamSplitValidationError,
  createTeamSplitSession,
  listTeamSplitSessions,
  normalizeTeamSplitConfig,
  type TeamSplitMode,
  type TeamSplitPrismaClient,
  type TeamSplitSessionStatus,
} from '@herta/plugin-catalog/team-split-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';
import { toPublicTeamSplitSession } from '@/lib/team-split';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const url = new URL(request.url);
  const statusValue = url.searchParams.get('status');
  const status = isStatus(statusValue) ? statusValue : undefined;
  const query = (url.searchParams.get('query') ?? '').trim().toLocaleLowerCase('ja');

  try {
    const rows = await listTeamSplitSessions(prisma as unknown as TeamSplitPrismaClient, {
      guildId,
      status,
      take: 100,
    });
    const filtered = query
      ? rows.filter(
          (row) =>
            row.title.toLocaleLowerCase('ja').includes(query) ||
            row.id.toLocaleLowerCase('ja').includes(query),
        )
      : rows;
    return NextResponse.json(filtered.map(toPublicTeamSplitSession));
  } catch (error) {
    console.error('Team Split sessions API request failed', safeErrorName(error));
    return NextResponse.json(
      { error: 'Team Splitセッションの取得に失敗しました' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const authSession = await auth();
  if (!authSession?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, authSession.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON bodyが不正です' }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'セッション内容が不正です' }, { status: 400 });
  }

  try {
    const plugin = await getGuildPlugin(guildId, 'team-split');
    if (!plugin?.enabled) {
      return NextResponse.json({ error: 'Team Split Pluginが無効です' }, { status: 409 });
    }
    const secret = resolveSecret();
    const mode = body['mode'];
    if (!isMode(mode)) throw new TeamSplitValidationError('modeはrandomまたはbalancedです');

    const created = await createTeamSplitSession(prisma as unknown as TeamSplitPrismaClient, {
      guildId,
      creatorId: authSession.user.id,
      actorId: authSession.user.id,
      config: normalizeTeamSplitConfig(plugin.config),
      secret,
      creatorScore: numberOrNull(body['creatorScore']),
      session: {
        channelId: stringOrEmpty(body['channelId']),
        title: stringOrEmpty(body['title']),
        mode,
        teamCount: numberOrNaN(body['teamCount']),
        maxParticipants: numberOrNaN(body['maxParticipants']),
        durationMinutes: numberOrNull(body['durationMinutes']),
        seed: typeof body['seed'] === 'string' ? body['seed'] : null,
      },
    });
    return NextResponse.json(toPublicTeamSplitSession(created), { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Team Splitセッションの作成に失敗しました');
  }
}

function resolveSecret(): string {
  const value = process.env['TEAM_SPLIT_SECRET']?.trim() ?? '';
  if (value.length < 32) throw new Error('TeamSplitSecretUnavailable');
  return value;
}

function isStatus(value: string | null): value is TeamSplitSessionStatus {
  return value === 'open' || value === 'split' || value === 'closed' || value === 'expired';
}

function isMode(value: unknown): value is TeamSplitMode {
  return value === 'random' || value === 'balanced';
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNaN(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function errorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof TeamSplitValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Team Split API request failed', safeErrorName(error));
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 120) : 'UnknownError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
