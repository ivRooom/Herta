import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  authorizeGuild,
  findPluginManifest,
  getGuildPlugin,
  updateGuildPlugin,
  validatePluginConfig,
} from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ guildId: string; pluginId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId, pluginId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const plugin = await getGuildPlugin(guildId, pluginId);
  if (!plugin) return NextResponse.json({ error: 'Plugin が見つかりません' }, { status: 404 });
  return NextResponse.json(plugin);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; pluginId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId, pluginId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const manifest = findPluginManifest(pluginId);
  if (!manifest) return NextResponse.json({ error: 'Plugin が見つかりません' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
  if (!isPatchBody(body))
    return NextResponse.json({ error: '更新内容が不正です' }, { status: 400 });

  if (body.config !== undefined) {
    const validation = validatePluginConfig(manifest, body.config);
    if (!validation.valid) {
      return NextResponse.json(
        { error: '設定がスキーマに適合しません', details: validation.errors },
        { status: 400 },
      );
    }
  }

  const result = await updateGuildPlugin(guildId, pluginId, session.user.id, body);
  if (!result || !('manifest' in result)) {
    return NextResponse.json({ error: '設定が不正です' }, { status: 400 });
  }
  return NextResponse.json(result);
}

function isPatchBody(value: unknown): value is { enabled?: boolean; config?: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (
    (body.enabled === undefined || typeof body.enabled === 'boolean') &&
    (body.config === undefined ||
      (typeof body.config === 'object' && body.config !== null && !Array.isArray(body.config)))
  );
}
