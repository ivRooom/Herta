import { NextResponse } from 'next/server';
import { defaultValorantAgents } from '@herta/plugin-catalog';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { resolvePluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/bounded-request-body';

export const dynamic = 'force-dynamic';
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isScore = (value: unknown) => typeof value === 'number' && Number.isInteger(value) &&
  value >= 0 && value <= 100;
const isKda = (value: unknown) => typeof value === 'number' && Number.isInteger(value) &&
  value >= 0 && value <= 200;
const isSessionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);

async function authorized(guildId: string, method: string, request: Request) {
  if (!/^\d{17,20}$/.test(guildId)) return { response: NextResponse.json({ error: 'Invalid guild' }, { status: 400 }) };
  const session = await auth();
  if (!session?.user) return { response: NextResponse.json({ error: '認証が必要です。' }, { status: 401 }) };
  if (method !== 'GET' && !isSameOriginMutationRequest(request)) {
    return { response: NextResponse.json({ error: '不正なリクエスト元です。' }, { status: 403 }) };
  }
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return { response: access.response };
  const permission = resolvePluginConfigStudioAccess(access.access, guildId, 'valorant', ['enabledAgents']);
  const read = permission.readableConfigPaths.includes('enabledAgents');
  const write = permission.editableConfigPaths.includes('enabledAgents');
  if (!read || (method !== 'GET' && !write))
    return { response: NextResponse.json({ error: '試合結果の管理権限がありません。' }, { status: 403 }) };
  return { userId: session.user.id, canWrite: write };
}

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await authorized(guildId, 'GET', request);
  if ('response' in access) return access.response;
  try {
    const [sessions, reports] = await Promise.all([
      prisma.valorantPickSession.findMany({
        where: { guildId, status: 'COMPLETED' },
        select: { id: true, mode: true, mapId: true, completedAt: true, result: true },
        orderBy: { completedAt: 'desc' }, take: 100,
      }),
      prisma.valorantMatchResult.findMany({
        where: { guildId }, orderBy: { createdAt: 'desc' }, take: 100,
        select: {
          id: true, sessionId: true, mapId: true, outcome: true,
          roundsWon: true, roundsLost: true, playerResults: true, matchId: true,
          createdAt: true, source: true,
        },
      }),
    ]);
    return NextResponse.json({ sessions, reports, canWrite: access.canWrite },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('VALORANT result listing failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: '試合結果を取得できません。' }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await authorized(guildId, 'POST', request);
  if ('response' in access) return access.response;
  let data: unknown;
  try {
    data = await readJsonBodyWithLimit(request, 8192);
  } catch (error) {
    return NextResponse.json({ error: 'リクエストが不正です。' }, {
      status: error instanceof RequestBodyTooLargeError ? 413 : 400,
    });
  }
  const knownMaps = new Set(['Ascent','Bind','Haven','Split','Icebox','Breeze',
    'Fracture','Pearl','Lotus','Sunset','Abyss','Corrode','Summit']);
  if (!isObject(data) || !isSessionId(data.sessionId) ||
    typeof data.mapId !== 'string' || !knownMaps.has(data.mapId) ||
    !['WIN', 'LOSS', 'DRAW'].includes(String(data.outcome)) ||
    !isScore(data.roundsWon) || !isScore(data.roundsLost) ||
    (data.matchId !== null && data.matchId !== undefined &&
      (typeof data.matchId !== 'string' || !/^[a-zA-Z0-9-]{4,128}$/.test(data.matchId))) ||
    !Array.isArray(data.playerResults) || data.playerResults.length > 5) {
    return NextResponse.json({ error: '試合結果の形式が不正です。' }, { status: 400 });
  }
  const matchId = data.matchId === undefined || data.matchId === null ? null : data.matchId as string;
  try {
    const session = await prisma.valorantPickSession.findFirst({
      where: { id: data.sessionId, guildId, status: 'COMPLETED' },
      select: { id: true, participants: { select: { userId: true } } },
    });
    if (!session) return NextResponse.json({ error: '抽選セッションが見つかりません。' }, { status: 404 });
    const roster = await prisma.valorantAgent.findMany({ where: { guildId }, select: { agentId: true } });
    const allowedIds = new Set([
      ...defaultValorantAgents().map((agent) => agent.agentId),
      ...roster.map((agent) => agent.agentId),
    ]);
    const expected = new Set(session.participants.map((person) => person.userId));
    const valid = data.playerResults.every((value) =>
      isObject(value) && typeof value.userId === 'string' && expected.has(value.userId) &&
      typeof value.agentId === 'string' && allowedIds.has(value.agentId) &&
      isKda(value.kills) && isKda(value.deaths) && isKda(value.assists));
    const unique = new Set(data.playerResults.map((entry) => isObject(entry) ? entry.userId : undefined));
    if (!valid || unique.size !== expected.size || data.playerResults.length !== expected.size) {
      return NextResponse.json({ error: '参加者全員の実使用エージェントとK/D/Aを正しく指定してください。' }, { status: 400 });
    }
    const created = await prisma.valorantMatchResult.create({
      data: {
        sessionId: session.id, guildId, mapId: data.mapId, outcome: data.outcome as string,
        roundsWon: data.roundsWon as number, roundsLost: data.roundsLost as number,
        matchId, playerResults: JSON.parse(JSON.stringify(data.playerResults)),
        source: 'MANUAL', enteredBy: access.userId!,
      },
      select: { id: true, sessionId: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ error: 'このセッションまたはMatch IDは登録済みです。' }, { status: 409 });
    }
    console.error('VALORANT manual result registration failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: '試合結果を登録できません。' }, { status: 503 });
  }
}
