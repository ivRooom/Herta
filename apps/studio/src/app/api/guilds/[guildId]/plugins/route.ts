import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  authorizeGuild,
  findPluginManifest,
  listGuildPlugins,
  updateGuildPlugin,
} from '@/lib/guild-plugins';
import { parsePluginBulkUpdateRequest } from '@/lib/plugin-bulk-update';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  return NextResponse.json({ plugins: await listGuildPlugins(guildId) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }

  const body = parsePluginBulkUpdateRequest(rawBody);
  if (!body) {
    return NextResponse.json(
      { error: 'updatesには重複しないPlugin IDと有効状態を1〜100件指定してください' },
      { status: 400 },
    );
  }

  const unknownPluginIds = body.updates
    .map((update) => update.pluginId)
    .filter((pluginId) => !findPluginManifest(pluginId));
  if (unknownPluginIds.length > 0) {
    return NextResponse.json(
      { error: '存在しないPluginが含まれています', pluginIds: unknownPluginIds },
      { status: 404 },
    );
  }

  const plugins = [];
  const results: Array<{
    pluginId: string;
    enabled: boolean;
    success: boolean;
    error?: string;
  }> = [];

  for (const update of body.updates) {
    try {
      const plugin = await updateGuildPlugin(guildId, update.pluginId, session.user.id, {
        enabled: update.enabled,
      });
      if (!plugin || !('manifest' in plugin)) {
        results.push({
          pluginId: update.pluginId,
          enabled: update.enabled,
          success: false,
          error: `${update.pluginId} の更新に失敗しました`,
        });
        continue;
      }

      plugins.push(plugin);
      results.push({ pluginId: update.pluginId, enabled: plugin.enabled, success: true });
    } catch (error) {
      results.push({
        pluginId: update.pluginId,
        enabled: update.enabled,
        success: false,
        error: error instanceof Error ? error.message : `${update.pluginId} の更新に失敗しました`,
      });
    }
  }

  const failedCount = results.filter((result) => !result.success).length;
  return NextResponse.json({
    plugins,
    results,
    successCount: results.length - failedCount,
    failedCount,
  });
}
