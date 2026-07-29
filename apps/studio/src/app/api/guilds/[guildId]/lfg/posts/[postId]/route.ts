import { NextResponse } from 'next/server';
import {
  closeLfgPost,
  getLfgPost,
  listLfgParticipants,
  type LfgPrismaClient,
} from '@herta/plugin-catalog/lfg-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; postId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, postId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const [post, participants] = await Promise.all([
      getLfgPost(prisma as unknown as LfgPrismaClient, guildId, postId),
      listLfgParticipants(prisma as unknown as LfgPrismaClient, guildId, postId),
    ]);
    if (!post) return NextResponse.json({ error: '募集が見つかりません' }, { status: 404 });
    return NextResponse.json({ post, participants });
  } catch (error) {
    console.error('LFG detail API request failed', error);
    return NextResponse.json({ error: 'LFG募集の取得に失敗しました' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, postId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON bodyが不正です' }, { status: 400 });
  }
  if (!isRecord(body) || (body['action'] !== 'close' && body['action'] !== 'cancel')) {
    return NextResponse.json({ error: 'actionにはcloseまたはcancelを指定してください' }, { status: 400 });
  }

  try {
    const result = await closeLfgPost(prisma as unknown as LfgPrismaClient, {
      guildId,
      postId,
      actorId: session.user.id,
      mode: body['action'] === 'close' ? 'closed' : 'cancelled',
      force: true,
    });
    if (result.state === 'not_found') {
      return NextResponse.json({ error: '募集が見つかりません' }, { status: 404 });
    }
    if (result.state === 'already_final') {
      return NextResponse.json(result.post);
    }
    if (result.state === 'forbidden') {
      return NextResponse.json({ error: '操作権限がありません' }, { status: 403 });
    }
    return NextResponse.json(result.post);
  } catch (error) {
    console.error('LFG update API request failed', error);
    return NextResponse.json({ error: 'LFG募集の更新に失敗しました' }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
