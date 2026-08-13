import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { authorizeGuild } from '@/lib/guild-plugins';
import {
  getLatestXpRoleSweepStatus,
  requestXpRoleSweep,
} from '@/lib/xp-role-sweep';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const status = await getLatestXpRoleSweepStatus(guildId);
  return NextResponse.json({ status }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
  const note =
    typeof body === 'object' && body !== null && typeof (body as { note?: unknown }).note === 'string'
      ? (body as { note: string }).note.trim().slice(0, 240)
      : null;

  const latest = await getLatestXpRoleSweepStatus(guildId);
  if (
    latest?.status === 'queued' &&
    Date.now() - new Date(latest.createdAt).getTime() < 30_000
  ) {
    return NextResponse.json(
      { error: '一括修復はすでにキューへ送信されています', status: latest },
      { status: 409 },
    );
  }

  const result = await requestXpRoleSweep({
    guildId,
    actorId: session.user.id,
    reason: 'manual_repair',
    note,
  });
  const status = await getLatestXpRoleSweepStatus(guildId);
  return NextResponse.json(
    { request: result, status },
    { status: result.queued ? 202 : 503, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
