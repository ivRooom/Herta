import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getManageableGuild } from '@/lib/guilds';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { getDiscordAccessToken } from '@/lib/session';
import {
  getDefaultStudioGuildId,
  setDefaultStudioGuildId,
} from '@/lib/studio-user-preferences';
import { normalizeOptionalGuildId } from '@/lib/studio-server-preferences';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  try {
    return NextResponse.json({ defaultGuildId: await getDefaultStudioGuildId(session.user.id) });
  } catch (error) {
    console.error('Studioユーザー設定の取得に失敗しました', {
      userId: session.user.id,
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Studio設定を取得できませんでした' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 1_024) {
    return NextResponse.json({ error: 'リクエストサイズが大きすぎます' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }

  if (!isRecord(body) || !('defaultGuildId' in body)) {
    return NextResponse.json({ error: 'defaultGuildId が必要です' }, { status: 400 });
  }

  const defaultGuildId = body.defaultGuildId === null ? null : normalizeOptionalGuildId(body.defaultGuildId);
  if (body.defaultGuildId !== null && !defaultGuildId) {
    return NextResponse.json({ error: 'Server IDが不正です' }, { status: 400 });
  }

  if (defaultGuildId) {
    const accessToken = await getDiscordAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: 'Discordの再ログインが必要です' }, { status: 401 });
    }
    try {
      const guild = await getManageableGuild(accessToken, defaultGuildId);
      if (!guild) {
        return NextResponse.json(
          { error: '管理権限を持つサーバーだけデフォルトに設定できます' },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json({ error: 'Discordのサーバー情報を確認できませんでした' }, { status: 502 });
    }
  }

  try {
    await setDefaultStudioGuildId(session.user.id, defaultGuildId);
    return NextResponse.json({ defaultGuildId });
  } catch (error) {
    console.error('Studioデフォルトサーバーの保存に失敗しました', {
      userId: session.user.id,
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'デフォルトサーバーを保存できませんでした' }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
