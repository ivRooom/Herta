import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import {
  findPluginManifest,
  getGuildPlugin,
  updateGuildPlugin,
  validatePluginConfig,
} from '@/lib/guild-plugins';
import { toPluginConfigValidationIssues } from '@/lib/plugin-config-validation-issues';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { resolveStudioAccess } from '@/lib/studio-access';
import {
  filterReadablePluginConfig,
  hasEffectivePluginPermission,
  pluginConfigFieldResource,
  pluginEnabledControlResource,
  resolvePluginConfigStudioAccess,
} from '@/lib/studio-plugin-permissions';

export const dynamic = 'force-dynamic';
const MAX_PLUGIN_PATCH_BODY_BYTES = 128 * 1024;
const MAX_REMOVED_CONFIG_FIELDS = 256;
const MAX_CONFIG_FIELD_KEY_LENGTH = 200;

type PluginPatchBody = {
  enabled?: boolean;
  config?: Record<string, unknown>;
  configPatch?: Record<string, unknown>;
  removeConfigFields?: string[];
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ guildId: string; pluginId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId, pluginId } = await params;
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;

  const plugin = await getGuildPlugin(guildId, pluginId);
  if (!plugin) return NextResponse.json({ error: 'Plugin が見つかりません' }, { status: 404 });
  const configAccess = resolvePluginConfigStudioAccess(
    access.access,
    guildId,
    pluginId,
    topLevelConfigFieldKeys(plugin.manifest.configSchema),
  );
  return NextResponse.json({
    ...plugin,
    config: filterReadablePluginConfig(plugin.config, configAccess),
    configAccess,
  });
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
    if (!hasEffectivePluginPermission(access.access, 'studio.operation.execute', resource)) {
      return NextResponse.json(
        { error: 'このPluginを有効化・無効化する権限がありません', resource },
        { status: 403 },
      );
    }
  }

  const candidateConfig = resolveCandidateConfig(current.config, body.value);
  let validatedConfig: Record<string, unknown> | undefined;
  if (candidateConfig !== undefined) {
    const validation = validatePluginConfig(manifest, candidateConfig);
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
    validatedConfig = validation.config;

    const changedFields = changedTopLevelFields(current.config, validation.config);
    const deniedFields = changedFields.filter(
      (fieldKey) =>
        !hasEffectivePluginPermission(
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

  const updateInput: { enabled?: boolean; config?: Record<string, unknown> } = {};
  if (body.value.enabled !== undefined) updateInput.enabled = body.value.enabled;
  if (validatedConfig !== undefined) updateInput.config = validatedConfig;
  const result = await updateGuildPlugin(guildId, pluginId, session.user.id, updateInput);
  if (!result || !('manifest' in result)) {
    return NextResponse.json({ error: '設定が不正です' }, { status: 400 });
  }

  const configAccess = resolvePluginConfigStudioAccess(
    access.access,
    guildId,
    pluginId,
    topLevelConfigFieldKeys(result.manifest.configSchema),
  );
  return NextResponse.json({
    ...result,
    config: filterReadablePluginConfig(result.config, configAccess),
    configAccess,
  });
}

async function parsePatchBody(
  request: Request,
): Promise<{ value: PluginPatchBody } | { response: Response }> {
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

function isPatchBody(value: unknown): value is PluginPatchBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (
    keys.some(
      (key) =>
        key !== 'enabled' &&
        key !== 'config' &&
        key !== 'configPatch' &&
        key !== 'removeConfigFields',
    )
  ) {
    return false;
  }
  if (body.config !== undefined && (body.configPatch !== undefined || body.removeConfigFields !== undefined)) {
    return false;
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return false;
  if (body.config !== undefined && !isRecord(body.config)) return false;
  if (body.configPatch !== undefined && !isRecord(body.configPatch)) return false;
  if (body.removeConfigFields !== undefined) {
    if (!Array.isArray(body.removeConfigFields) || body.removeConfigFields.length > MAX_REMOVED_CONFIG_FIELDS) {
      return false;
    }
    if (
      body.removeConfigFields.some(
        (field) =>
          typeof field !== 'string' ||
          field.length === 0 ||
          field.length > MAX_CONFIG_FIELD_KEY_LENGTH,
      )
    ) {
      return false;
    }
  }
  return true;
}

function resolveCandidateConfig(
  current: Record<string, unknown>,
  body: PluginPatchBody,
): Record<string, unknown> | undefined {
  if (body.config !== undefined) return body.config;
  if (body.configPatch === undefined && body.removeConfigFields === undefined) return undefined;
  const next = { ...current, ...(body.configPatch ?? {}) };
  for (const field of body.removeConfigFields ?? []) delete next[field];
  return next;
}

function topLevelConfigFieldKeys(schema: Record<string, unknown>): string[] {
  const properties = schema['properties'];
  if (!isRecord(properties)) return [];
  return Object.keys(properties);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
