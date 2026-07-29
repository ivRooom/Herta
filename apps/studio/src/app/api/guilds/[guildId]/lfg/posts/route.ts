import { NextResponse } from 'next/server';
import {
  LfgValidationError,
  createLfgPost,
  listLfgPosts,
  normalizeLfgConfig,
  type LfgPostInput,
  type LfgPostStatus,
  type LfgPrismaClient,
} from '@herta/plugin-catalog/lfg-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';

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
  const status = isLfgPostStatus(statusValue) ? statusValue : undefined;
  const query = (url.searchParams.get('query') ?? '').trim().toLocaleLowerCase('ja');

  try {
    const rows = await listLfgPosts(prisma as unknown as LfgPrismaClient, {
      guildId,
      status,
      take: 100,
    });
    const posts = query
      ? rows.filter(
          (post) =>
            post.title.toLocaleLowerCase('ja').includes(query) ||
            post.game.toLocaleLowerCase('ja').includes(query) ||
            post.id.toLocaleLowerCase('ja').includes(query),
        )
      : rows;
    return NextResponse.json(posts);
  } catch (error) {
    return lfgErrorResponse(error, 'LFG募集の取得に失敗しました');
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON bodyが不正です' }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: '募集内容が不正です' }, { status: 400 });
  }

  try {
    const plugin = await getGuildPlugin(guildId, 'lfg');
    const config = normalizeLfgConfig(plugin?.config);
    const postInput = parsePostInput(body);
    const post = await createLfgPost(prisma as unknown as LfgPrismaClient, {
      guildId,
      creatorId: session.user.id,
      actorId: session.user.id,
      post: postInput,
      config,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    return lfgErrorResponse(error, 'LFG募集の作成に失敗しました');
  }
}

function parsePostInput(body: Record<string, unknown>): LfgPostInput {
  const startTimeValue = body['startTime'];
  const startTime =
    typeof startTimeValue === 'string' && startTimeValue.trim()
      ? new Date(startTimeValue)
      : null;
  if (startTime && !Number.isFinite(startTime.getTime())) {
    throw new LfgValidationError('startTimeは有効なISO-8601日時で指定してください');
  }

  return {
    channelId: typeof body['channelId'] === 'string' ? body['channelId'] : '',
    game: typeof body['game'] === 'string' ? body['game'] : '',
    title: typeof body['title'] === 'string' ? body['title'] : '',
    description: typeof body['description'] === 'string' ? body['description'] : null,
    maxPlayers: typeof body['maxPlayers'] === 'number' ? body['maxPlayers'] : Number.NaN,
    startTime,
    durationMinutes:
      typeof body['durationMinutes'] === 'number' ? body['durationMinutes'] : null,
  };
}

function lfgErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof LfgValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('LFG posts API request failed', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function isLfgPostStatus(value: string | null): value is LfgPostStatus {
  return (
    value === 'open' ||
    value === 'full' ||
    value === 'closed' ||
    value === 'cancelled' ||
    value === 'expired'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
