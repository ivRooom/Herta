import { getAllPluginManifests } from '@herta/plugin-catalog';
import type { PluginManifest } from '@herta/shared';
import { describeAuditEvent } from '@/lib/audit-logs';
import { prisma } from '@/lib/db';
import { validatePluginConfig } from '@/lib/guild-plugins';
import {
  summarizePluginOperations,
  type PluginOperationInventoryRow,
  type PluginOperationsInventory,
} from './plugin-operations-core.ts';
import {
  PLUGIN_RUNTIME_AUDIT_EVENTS,
  buildPluginRuntimeOperationStateMap,
  pluginRuntimeOperationStateKey,
} from './plugin-runtime-operation-state.ts';

const RECENT_OPERATION_LIMIT = 12;
const MIN_RUNTIME_AUDIT_READ_LIMIT = 48;
const MAX_RUNTIME_AUDIT_READ_LIMIT = 1_000;
const RUNTIME_AUDIT_ROWS_PER_PLUGIN = 12;

const RUNTIME_EVENT_PRESENTATION: Record<string, { eventLabel: string; sourceLabel: string }> = {
  'plugin.runtime_publish_succeeded': {
    eventLabel: 'Runtime通知を送信',
    sourceLabel: 'Studio Runtime',
  },
  'plugin.runtime_publish_failed': {
    eventLabel: 'Runtime通知の送信に失敗',
    sourceLabel: 'Studio Runtime',
  },
  'plugin.runtime_apply_succeeded': {
    eventLabel: 'Runtime設定をBotへ反映',
    sourceLabel: 'Bot Runtime',
  },
  'plugin.runtime_apply_failed': {
    eventLabel: 'Runtime設定のBot反映に失敗',
    sourceLabel: 'Bot Runtime',
  },
};

export interface RecentPluginOperation {
  id: string;
  guildId: string;
  pluginId: string;
  pluginName: string;
  event: string;
  eventLabel: string;
  sourceLabel: string | null;
  severity: string;
  createdAt: string;
}

export async function getPluginOperationsInventory(
  guildIds: readonly string[],
): Promise<PluginOperationsInventory> {
  const manifests = getAllPluginManifests();
  const pluginIds = manifests.map((manifest) => manifest.id);

  if (guildIds.length === 0 || pluginIds.length === 0) {
    return summarizePluginOperations(guildIds, manifests.length, []);
  }

  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const rows = await prisma.guildPlugin.findMany({
    where: {
      guildId: { in: [...guildIds] },
      pluginId: { in: pluginIds },
    },
    select: {
      guildId: true,
      pluginId: true,
      enabled: true,
      config: true,
      configVersion: true,
      installedAt: true,
      updatedAt: true,
    },
  });

  const runtimeReadLimit = Math.min(
    MAX_RUNTIME_AUDIT_READ_LIMIT,
    Math.max(MIN_RUNTIME_AUDIT_READ_LIMIT, rows.length * RUNTIME_AUDIT_ROWS_PER_PLUGIN),
  );
  const runtimeRows =
    rows.length === 0
      ? []
      : await prisma.auditLog.findMany({
          where: {
            guildId: { in: [...guildIds] },
            targetType: 'plugin',
            targetId: { in: pluginIds },
            event: { in: PLUGIN_RUNTIME_AUDIT_EVENTS },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: runtimeReadLimit,
          select: {
            guildId: true,
            targetId: true,
            event: true,
            metadata: true,
            createdAt: true,
          },
        });
  const runtimeStateByPluginVersion = buildPluginRuntimeOperationStateMap(runtimeRows);

  const inventoryRows: PluginOperationInventoryRow[] = [];
  for (const row of rows) {
    const manifest = manifestById.get(row.pluginId);
    if (!manifest) continue;
    const runtimeState = runtimeStateByPluginVersion.get(
      pluginRuntimeOperationStateKey(row.guildId, row.pluginId, row.configVersion),
    );

    inventoryRows.push({
      guildId: row.guildId,
      pluginId: row.pluginId,
      pluginName: manifest.name,
      enabled: row.enabled,
      configValid: isStoredConfigValid(manifest, row.config, row.guildId),
      configVersion: row.configVersion,
      installedAt: row.installedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(runtimeState
        ? {
            runtimeStatus: runtimeState.status,
            runtimeConfigVersion: runtimeState.configVersion,
            runtimeObservedAt: runtimeState.observedAt,
          }
        : {}),
    });
  }

  return summarizePluginOperations(guildIds, manifests.length, inventoryRows);
}

export async function listRecentPluginOperations(
  guildIds: readonly string[],
): Promise<RecentPluginOperation[]> {
  if (guildIds.length === 0) return [];

  const manifests = getAllPluginManifests();
  const pluginIds = manifests.map((manifest) => manifest.id);
  if (pluginIds.length === 0) return [];
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));

  const rows = await prisma.auditLog.findMany({
    where: {
      guildId: { in: [...guildIds] },
      event: { startsWith: 'plugin.' },
      targetType: 'plugin',
      targetId: { in: pluginIds },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: RECENT_OPERATION_LIMIT,
    select: {
      id: true,
      guildId: true,
      event: true,
      targetId: true,
      metadata: true,
      severity: true,
      createdAt: true,
    },
  });

  return rows.flatMap((row) => {
    if (!row.targetId) return [];
    const manifest = manifestById.get(row.targetId);
    if (!manifest) return [];
    const presentation = describeAuditEvent(row.event, 'plugin', row.targetId, row.metadata);
    const runtimePresentation = RUNTIME_EVENT_PRESENTATION[row.event];
    return [
      {
        id: row.id,
        guildId: row.guildId,
        pluginId: row.targetId,
        pluginName: manifest.name,
        event: row.event,
        eventLabel: runtimePresentation?.eventLabel ?? presentation.eventLabel,
        sourceLabel: runtimePresentation?.sourceLabel ?? presentation.sourceLabel,
        severity: row.severity,
        createdAt: row.createdAt.toISOString(),
      },
    ];
  });
}

function isStoredConfigValid(manifest: PluginManifest, config: unknown, guildId: string): boolean {
  try {
    return validatePluginConfig(manifest, config).valid;
  } catch (error) {
    console.error('Plugin Operationsで保存済み設定の検証に失敗しました', {
      guildId,
      pluginId: manifest.id,
      error,
    });
    return false;
  }
}
