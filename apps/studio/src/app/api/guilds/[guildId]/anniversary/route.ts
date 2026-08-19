import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import {
  getGuildAnniversary,
  isValidGuildAnniversaryDate,
  removeGuildAnniversary,
  setGuildAnniversary,
} from '@/lib/guild-anniversary';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasEffectivePluginPermission } from '@/lib/studio-plugin-permissions';
import { studioBotProfileSettingResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

const BODY_MAX_BYTES = 8 * 1024;

type GuildRouteContext = { params: Promise<{ guildId: string }> };

export async function GET(_request: Request, { params }: GuildRouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeAnniversarySetting(
    guildId,
    session.user.id,
    'studio.settings.read',
  );
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(
      { anniversary: await getGuildAnniversary(guildId) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Failed to read guild anniversary', {
      guildId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'サーバー周年日を取得できませんでした' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: GuildRouteContext) {
  return mutateAnniversary(request, params, 'set');
}

export async function DELETE(request: Request, { params }: GuildRouteContext) {
  return mutateAnniversary(request, params, 'remove');
}

async function mutateAnniversary(
  request: Request,
  params: Promise<{ guildId: string }>,
  action: 'set' | 'remove',
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なOriginです' }, { status: 403 });
  }

  const { guildId } = await params;
  const authorization = await authorizeAnniversarySetting(
    guildId,
    session.user.id,
    'studio.settings.write',
  );
  if (!authorization.ok) return authorization.response;

  try {
    if (action === 'remove') {
      const changed = await removeGuildAnniversary({ guildId, actorId: session.user.id });
      return NextResponse.json({ anniversary: null, changed });
    }

    const body = await readJsonBodyWithLimit(request, BODY_MAX_BYTES);
    const anniversaryDate = readAnniversaryDate(body);
    if (!anniversaryDate || !isValidGuildAnniversaryDate(anniversaryDate)) {
      return NextResponse.json(
        { error: '周年日は実在する過去または今日の日付をYYYY-MM-DDで指定してください' },
        { status: 400 },
      );
    }
    const anniversary = await setGuildAnniversary({
      guildId,
      actorId: session.user.id,
      anniversaryDate,
    });
    return NextResponse.json({ anniversary });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'リクエストが大きすぎます' }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'JSON形式が不正です' }, { status: 400 });
    }
    console.error('Guild anniversary mutation failed', {
      guildId,
      action,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'サーバー周年日の更新に失敗しました' }, { status: 500 });
  }
}

async function authorizeAnniversarySetting(
  guildId: string,
  userId: string,
  action: 'studio.settings.read' | 'studio.settings.write',
) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  const allowed = hasEffectivePluginPermission(
    resolved.access,
    action,
    studioBotProfileSettingResource(guildId, 'anniversary'),
  );
  if (allowed) return resolved;
  return {
    ok: false as const,
    response: Response.json(
      { error: 'サーバー周年日を操作するHerta Studio権限がありません' },
      { status: 403 },
    ),
  };
}

function readAnniversaryDate(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>).anniversaryDate;
  return typeof candidate === 'string' ? candidate.trim() : null;
}
