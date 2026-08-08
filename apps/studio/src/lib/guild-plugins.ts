import Ajv, { type ErrorObject } from 'ajv';
import type { Prisma } from '@herta/db';
import type { PluginManifest } from '@herta/shared';
import { getAllPluginManifests, getPluginManifest } from '@herta/plugin-catalog';
import { normalizeAutoResponseConfig } from '@herta/plugin-catalog/auto-response-service';
import { prisma } from '@/lib/db';
import { DiscordApiError } from '@/lib/discord';
import { discordApiErrorResponse } from '@/lib/discord-api-response';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { publishPluginRuntimeEvent } from '@/lib/plugin-runtime-events';
import { getDiscordAccessToken } from '@/lib/session';

const ajv = new Ajv({ allErrors: true, useDefaults: true });

export type PluginConfig = Record<string, unknown>;

export function findPluginManifest(pluginId: string): PluginManifest | undefined {
  return getPluginManifest(pluginId);
}

export async function authorizeGuild(guildId: string, userId: string) {
  const accessToken = await getDiscordAccessToken();
  if (!accessToken)
    return {
      response: Response.json({ error: 'Discord の再ログインが必要です' }, { status: 401 }),
    };

  try {
    const guild = await getManageableGuild(accessToken, guildId);
    if (!guild) {
      return {
        response: Response.json(
          { error: 'この Guild を管理する権限がありません' },
          { status: 403 },
        ),
      };
    }

    await persistSelectedGuild(guild, userId);
    return { guild };
  } catch (error) {
    if (!(error instanceof DiscordApiError)) throw error;
    return { response: discordApiErrorResponse(error) };
  }
}

export async function listGuildPlugins(guildId: string) {
  const rows = await prisma.guildPlugin.findMany({ where: { guildId } });
  const rowMap = new Map(rows.map((row) => [row.pluginId, row]));

  return getAllPluginManifests().map((manifest) => {
    const row = rowMap.get(manifest.id);
    return {
      manifest,
      installed: Boolean(row),
      enabled: row?.enabled ?? false,
      config: isPluginConfig(row?.config) ? row.config : {},
      configVersion: row?.configVersion ?? 0,
    };
  });
}

export async function getGuildPlugin(guildId: string, pluginId: string) {
  const manifest = findPluginManifest(pluginId);
  if (!manifest) return undefined;

  const row = await prisma.guildPlugin.findUnique({
    where: { guildId_pluginId: { guildId, pluginId } },
  });

  return {
    manifest,
    installed: Boolean(row),
    enabled: row?.enabled ?? false,
    config: isPluginConfig(row?.config) ? row.config : {},
    configVersion: row?.configVersion ?? 0,
  };
}

export function validatePluginConfig(
  manifest: PluginManifest,
  config: unknown,
): { valid: true; config: PluginConfig } | { valid: false; errors: ErrorObject[] } {
  if (!isPluginConfig(config)) {
    return {
      valid: false,
      errors: [
        {
          keyword: 'type',
          instancePath: '',
          schemaPath: '#/type',
          params: {},
          message: 'must be an object',
        },
      ],
    };
  }

  const candidate =
    manifest.id === 'auto-response' ? { ...normalizeAutoResponseConfig(config) } : { ...config };
  const validate = ajv.compile(manifest.configSchema);
  if (!validate(candidate)) return { valid: false, errors: validate.errors ?? [] };
  return { valid: true, config: candidate };
}

export async function updateGuildPlugin(
  guildId: string,
  pluginId: string,
  actorId: string,
  input: { enabled?: boolean; config?: unknown },
) {
  const manifest = findPluginManifest(pluginId);
  if (!manifest) return undefined;

  const current = await getGuildPlugin(guildId, pluginId);
  const nextConfig = input.config === undefined ? (current?.config ?? {}) : input.config;
  const validation = validatePluginConfig(manifest, nextConfig);
  if (!validation.valid) return validation;

  const beforeEnabled = current?.enabled ?? false;
  const beforeConfig = current?.config ?? {};
  const nextEnabled = input.enabled ?? beforeEnabled;
  const configChanged = JSON.stringify(beforeConfig) !== JSON.stringify(validation.config);
  const enabledChanged = beforeEnabled !== nextEnabled;
  const runtimeChanged = configChanged || enabledChanged;
  const nextVersion = (current?.configVersion ?? 0) + (runtimeChanged ? 1 : 0);

  const result = await prisma.$transaction(async (tx) => {
    await tx.plugin.upsert({
      where: { id: manifest.id },
      create: {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        author: manifest.author.name,
        category: manifest.category,
        isOfficial: true,
        manifest: manifest as object,
      },
      update: {
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        author: manifest.author.name,
        category: manifest.category,
        manifest: manifest as object,
      },
    });

    const row = await tx.guildPlugin.upsert({
      where: { guildId_pluginId: { guildId, pluginId } },
      create: {
        guildId,
        pluginId,
        enabled: nextEnabled,
        config: toJson(validation.config),
        configVersion: nextVersion || 1,
      },
      update: {
        enabled: nextEnabled,
        config: toJson(validation.config),
        ...(runtimeChanged ? { configVersion: nextVersion } : {}),
      },
    });

    if (configChanged) {
      await tx.guildPluginConfigHistory.create({
        data: {
          guildId,
          pluginId,
          version: row.configVersion,
          config: toJson(validation.config),
          changedBy: actorId,
          changeReason: 'Studio から設定を更新',
        },
      });
    }

    if (enabledChanged) {
      await tx.auditLog.create({
        data: {
          guildId,
          actorId,
          event: nextEnabled ? 'plugin.enable' : 'plugin.disable',
          targetType: 'plugin',
          targetId: pluginId,
          changes: { before: { enabled: beforeEnabled }, after: { enabled: nextEnabled } },
          metadata: { operationSource: 'dashboard' },
        },
      });
    }
    if (configChanged) {
      await tx.auditLog.create({
        data: {
          guildId,
          actorId,
          event: 'plugin.config_update',
          targetType: 'plugin',
          targetId: pluginId,
          changes: {
            before: { config: beforeConfig },
            after: { config: toJson(validation.config) },
          },
          metadata: { operationSource: 'dashboard' },
        },
      });
    }

    return row;
  });

  if (runtimeChanged) {
    await publishPluginRuntimeEvent({
      guildId,
      pluginId,
      configVersion: result.configVersion,
      eventType: enabledChanged ? (result.enabled ? 'enabled' : 'disabled') : 'config_updated',
    });
  }

  return {
    manifest,
    installed: true,
    enabled: result.enabled,
    config: isPluginConfig(result.config) ? result.config : {},
    configVersion: result.configVersion,
  };
}

function isPluginConfig(value: unknown): value is PluginConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJson(value: PluginConfig): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
