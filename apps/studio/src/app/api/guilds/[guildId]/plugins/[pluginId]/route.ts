import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import {
  authorizeGuild,
  findPluginManifest,
  getGuildPlugin,
  updateGuildPlugin,
  validatePluginConfig,
} from '@/lib/guild-plugins';
import { toPluginConfigValidationIssues } from '@/lib/plugin-config-validation-issues';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { hasStudioPermission, resolveStudioAccess } from '@/lib/studio-access';
import {
  pluginConfigFieldResource,
  pluginEnabledControlResource,
} from '@/lib/studio-plugin-permissions';

export const dynamic = 'force-dynamic';
const MAX_PLUGIN_PATCH_BODY_BYTES = 128 * 1024;

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
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  const { guildId, pluginId } = await params;
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;

  const manifest = findPluginManifest(pluginId);
  if (!manifest) return NextResponse.json({ error: 'Plugin が見つかりません' }, { status: 404 });
  const current = await getGuildPlugin(guildId, pluginId);
  if (!current) return NextResponse.json({ error: 'Plugin が見つかりません' }, { status: 404 });

  const body = await parsePatchBody(request);
  if ('response' in body) return body.response;

  if (body.value.enabled !== undefined && body.value.enabled !== current.enabled) {
    const resource = pluginEnabledControlResource(guildId, pluginId);
    if (!hasStudioPermission(access.access, 'studio.operation.execute', resource)) {
      return NextResponse.json(
        { error: 'このPluginを有効化・無効化する権限がありません', resource },
        { status: 403 },
      );
    }
  }

  if (body.value.config !== undefined) {
    const validation = validatePluginConfig(manifest, body.value.config);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: '設定がスキーマに適合しません',
          details: validation.errors,
          issues: toPluginConfigValidationIssues(validation.errors),
        },
        { status: 400 },
      );
    }

    const changedFields = changedTopLevelFields(current.config, validation.config);
    const deniedFields = changedFields.filter(
      (fieldKey) =>
        !hasStudioPermission(
          access.access,
          'studio.settings.write',
          pluginConfigFieldResource(guildId, pluginId, fieldKey),
        ),
    );
    if (deniedFields.length > 0) {
      return NextResponse.json(
        {
          error: '編集権限のないPlugin設定項目が含まれています',
          fields: deniedFields,
        },
        { status: 403 },
      );
    }
  }

  const result = await updateGuildPlugin(guildId, pluginId, session.user.id, body.value);
  if (!result || !('manifest' in result)) {
    return NextResponse.json({ error: '設定が不正です' }, { status: 400 });
  }
  return NextResponse.json(result);
}

async function parsePatchBody(
  request: Request,
): Promise<{ value: { enabled?: boolean; config?: Record<string, unknown> } } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_PLUGIN_PATCH_BODY_BYTES);
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (!isPatchBody(value)) {
      return { response: NextResponse.json({ error: '更新内容が不正です' }, { status: 400 }) };
    }
    return { value };
  } catch (error) {
    return {
      response: NextResponse.json(
        {
          error:
            error instanceof RequestBodyTooLargeError
              ? 'Plugin設定の更新内容が大きすぎます'
              : 'JSON body が不正です',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}

function isPatchBody(
  value: unknown,
): value is { enabled?: boolean; config?: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'enabled' && key !== 'config')) return false;
  return (
    (body.enabled === undefined || typeof body.enabled === 'boolean') &&
    (body.config === undefined ||
      (typeof body.config === 'object' && body.config !== null && !Array.isArray(body.config)))
  );
}

function changedTopLevelFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !jsonEqual(before[key], after[key])).sort();
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
