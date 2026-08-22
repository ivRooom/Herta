import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import {
  BirthdayCardAssetSelectionUnavailableError,
  findPluginManifest,
  getGuildPlugin,
  updateGuildPlugin,
  validatePluginConfig,
} from '@/lib/guild-plugins';
import {
  changedTopLevelConfigFields,
  PluginConfigPathPatchError,
  resolvePluginConfigCandidate,
  type PluginConfigPatchInput,
} from '@/lib/plugin-config-patch';
import {
  pluginConfigPermissionPaths,
  resolvePluginConfigPermissionPath,
  type PluginConfigPathSegment,
} from '@/lib/plugin-config-paths';
import { toPluginConfigValidationIssues } from '@/lib/plugin-config-validation-issues';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { resolveStudioAccess } from '@/lib/studio-access';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';
import {
  filterReadablePluginConfig,
  hasEffectivePluginConfigPermission,
  hasEffectivePluginPermission,
  pluginEnabledControlResource,
  resolvePluginConfigStudioAccess,
} from '@/lib/studio-plugin-permissions';

export const dynamic = 'force-dynamic';
const MAX_PLUGIN_PATCH_BODY_BYTES = 128 * 1024;
const MAX_REMOVED_CONFIG_FIELDS = 256;
const MAX_CONFIG_FIELD_KEY_LENGTH = 200;
const MAX_CONFIG_PATH_OPERATIONS = 256;
const MAX_CONFIG_PATH_DEPTH = 16;

type PluginPatchBody = PluginConfigPatchInput & { enabled?: boolean };

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
    pluginConfigPermissionPaths(plugin.manifest.configSchema),
  );
  return NextResponse.json({
    ...plugin,
    config: filterReadablePluginConfig(plugin.config, configAccess, plugin.manifest.configSchema),
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

  const requestedPathAuthorization = authorizeRequestedConfigPaths(
    body.value,
    manifest.configSchema,
    access.access,
    guildId,
    pluginId,
  );
  if ('response' in requestedPathAuthorization) return requestedPathAuthorization.response;

  let candidateConfig: Record<string, unknown> | undefined;
  try {
    candidateConfig = resolvePluginConfigCandidate(current.config, body.value);
  } catch (error) {
    if (error instanceof PluginConfigPathPatchError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

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

    const changedFields = changedTopLevelConfigFields(current.config, validation.config);
    if (requestedPathAuthorization.usesLegacyPatch) {
      const deniedFields = changedFields.filter(
        (fieldKey) =>
          !hasEffectivePluginConfigPermission(
            access.access,
            'studio.settings.write',
            guildId,
            pluginId,
            fieldKey,
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

    const selectsBirthdayAsset =
      pluginId === 'birthday-role' &&
      validation.config['birthdayCardBackgroundSource'] === 'asset' &&
      changedFields.some(
        (fieldKey) =>
          fieldKey === 'birthdayCardBackgroundSource' || fieldKey === 'birthdayCardAssetId',
      );
    if (
      selectsBirthdayAsset &&
      !hasEffectivePluginPermission(
        access.access,
        'studio.settings.write',
        studioBirthdayResource(guildId, 'card-assets'),
      )
    ) {
      return NextResponse.json(
        {
          error: 'この画像をBirthday Card背景として使用する権限がありません',
          resource: studioBirthdayResource(guildId, 'card-assets'),
        },
        { status: 403 },
      );
    }
  }

  const updateInput: { enabled?: boolean; config?: Record<string, unknown> } = {};
  if (body.value.enabled !== undefined) updateInput.enabled = body.value.enabled;
  if (validatedConfig !== undefined) updateInput.config = validatedConfig;
  let result: Awaited<ReturnType<typeof updateGuildPlugin>>;
  try {
    result = await updateGuildPlugin(guildId, pluginId, session.user.id, updateInput);
  } catch (error) {
    if (error instanceof BirthdayCardAssetSelectionUnavailableError) {
      return NextResponse.json(
        { error: '選択したBirthday Card画像が見つかりません。画像を選び直してください' },
        { status: 409 },
      );
    }
    throw error;
  }
  if (!result || !('manifest' in result)) {
    return NextResponse.json({ error: '設定が不正です' }, { status: 400 });
  }

  const configAccess = resolvePluginConfigStudioAccess(
    access.access,
    guildId,
    pluginId,
    pluginConfigPermissionPaths(result.manifest.configSchema),
  );
  return NextResponse.json({
    ...result,
    config: filterReadablePluginConfig(result.config, configAccess, result.manifest.configSchema),
    configAccess,
  });
}

function authorizeRequestedConfigPaths(
  body: PluginPatchBody,
  schema: Record<string, unknown>,
  access: Parameters<typeof hasEffectivePluginConfigPermission>[0],
  guildId: string,
  pluginId: string,
): { usesLegacyPatch: boolean } | { response: Response } {
  const pathOperations = [
    ...(body.configPathPatch ?? []).map((operation) => operation.path),
    ...(body.removeConfigPaths ?? []),
  ];
  const usesLegacyPatch =
    body.config !== undefined || body.configPatch !== undefined || body.removeConfigFields !== undefined;
  if (pathOperations.length === 0) return { usesLegacyPatch };

  const invalidPaths: PluginConfigPathSegment[][] = [];
  const deniedPaths = new Set<string>();
  for (const path of pathOperations) {
    const canonical = resolvePluginConfigPermissionPath(schema, path);
    if (!canonical) {
      invalidPaths.push([...path]);
      continue;
    }
    if (
      !hasEffectivePluginConfigPermission(
        access,
        'studio.settings.write',
        guildId,
        pluginId,
        canonical,
      )
    ) {
      deniedPaths.add(canonical);
    }
  }

  if (invalidPaths.length > 0) {
    return {
      response: NextResponse.json(
        { error: 'Plugin設定パスがスキーマに存在しません', paths: invalidPaths },
        { status: 400 },
      ),
    };
  }
  if (deniedPaths.size > 0) {
    return {
      response: NextResponse.json(
        {
          error: '編集権限のないPlugin設定パスが含まれています',
          paths: [...deniedPaths].sort(),
        },
        { status: 403 },
      ),
    };
  }
  return { usesLegacyPatch: false };
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
  if (!isRecord(value)) return false;
  const body = value;
  const keys = Object.keys(body);
  if (
    keys.some(
      (key) =>
        key !== 'enabled' &&
        key !== 'config' &&
        key !== 'configPatch' &&
        key !== 'removeConfigFields' &&
        key !== 'configPathPatch' &&
        key !== 'removeConfigPaths',
    )
  ) {
    return false;
  }

  const hasPathPatch = body.configPathPatch !== undefined || body.removeConfigPaths !== undefined;
  const hasLegacyPatch =
    body.config !== undefined || body.configPatch !== undefined || body.removeConfigFields !== undefined;
  if (hasPathPatch && hasLegacyPatch) return false;
  if (
    body.config !== undefined &&
    (body.configPatch !== undefined || body.removeConfigFields !== undefined)
  ) {
    return false;
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return false;
  if (body.config !== undefined && !isRecord(body.config)) return false;
  if (body.configPatch !== undefined && !isRecord(body.configPatch)) return false;
  if (body.removeConfigFields !== undefined) {
    if (
      !Array.isArray(body.removeConfigFields) ||
      body.removeConfigFields.length > MAX_REMOVED_CONFIG_FIELDS
    ) {
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
  if (body.configPathPatch !== undefined) {
    if (
      !Array.isArray(body.configPathPatch) ||
      body.configPathPatch.length > MAX_CONFIG_PATH_OPERATIONS ||
      body.configPathPatch.some((operation) => !isConfigPathPatchOperation(operation))
    ) {
      return false;
    }
  }
  if (body.removeConfigPaths !== undefined) {
    if (
      !Array.isArray(body.removeConfigPaths) ||
      body.removeConfigPaths.length > MAX_CONFIG_PATH_OPERATIONS ||
      body.removeConfigPaths.some((path) => !isConfigPath(path))
    ) {
      return false;
    }
  }
  return true;
}

function isConfigPathPatchOperation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => key !== 'path' && key !== 'value')) return false;
  return Object.hasOwn(value, 'value') && isConfigPath(value.path);
}

function isConfigPath(value: unknown): value is PluginConfigPathSegment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CONFIG_PATH_DEPTH) {
    return false;
  }
  return value.every(
    (segment) =>
      (typeof segment === 'string' &&
        segment.length > 0 &&
        segment.length <= MAX_CONFIG_FIELD_KEY_LENGTH) ||
      (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
