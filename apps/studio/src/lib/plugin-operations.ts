import { getAllPluginManifests } from '@herta/plugin-catalog';
import {
  DEFAULT_PLUGIN_RUNTIME_CONSUMER,
  PLUGIN_RUNTIME_CONSUMERS,
  resolveExpectedRuntimeConsumers,
  type PluginManifest,
} from '@herta/shared';
import { describeAuditEvent } from '@/lib/audit-logs';
import { prisma } from '@/lib/db';
import { validatePluginConfig } from '@/lib/guild-plugins';
import {
  buildPluginRuntimeConsumerStates,
  summarizePluginOperations,
  type PluginOperationInventoryRow,
  type PluginOperationsInventory,
  type PluginRuntimeConsumerSignal,
} from './plugin-operations-core.ts';
import {
  PLUGIN_RUNTIME_AUDIT_EVENTS,
  buildPluginRuntimeConsumerOperationStateMap,
  pluginRuntimeConsumerOperationStateKey,
} from './plugin-runtime-operation-state.ts';

const RECENT_OPERATION_LIMIT = 12;

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

  const runtimeRows =
    rows.length === 0
      ? []
      : await prisma.auditLog.findMany({
          where: {
            guildId: { in: [...guildIds] },
            targetType: 'plugin',
            targetId: { in: pluginIds },
            event: { in: PLUGIN_RUNTIME_AUDIT_EVENTS },
            OR: rows.map((row) => ({
              guildId: row.guildId,
              targetId: row.pluginId,
              metadata: {
                path: ['configVersion'],
                equals: row.configVersion,
              },
            })),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            guildId: true,
            targetId: true,
            event: true,
            metadata: true,
            createdAt: true,
          },
        });
  const runtimeStateByConsumer = new Map(
    PLUGIN_RUNTIME_CONSUMERS.map((consumer) => [
      consumer,
      buildPluginRuntimeConsumerOperationStateMap(runtimeRows, consumer),
    ]),
  );

  const inventoryRows: PluginOperationInventoryRow[] = [];
  for (const row of rows) {
    const manifest = manifestById.get(row.pluginId);
    if (!manifest) continue;

    const runtimeSignals: PluginRuntimeConsumerSignal[] = PLUGIN_RUNTIME_CONSUMERS.flatMap(
      (consumer) => {
        const state = runtimeStateByConsumer
          .get(consumer)
          ?.get(
            pluginRuntimeConsumerOperationStateKey(
              row.guildId,
              row.pluginId,
              row.configVersion,
              consumer,
            ),
          );
        return state
          ? [
              {
                consumer,
                status: state.status,
                configVersion: state.configVersion,
                observedAt: state.observedAt,
              },
            ]
          : [];
      },
    );
    const runtimeConsumers = buildPluginRuntimeConsumerStates(
      resolveExpectedRuntimeConsumers(manifest),
      runtimeSignals,
    );
    const defaultRuntimeState = runtimeStateByConsumer
      .get(DEFAULT_PLUGIN_RUNTIME_CONSUMER)
      ?.get(
        pluginRuntimeConsumerOperationStateKey(
          row.guildId,
          row.pluginId,
          row.configVersion,
          DEFAULT_PLUGIN_RUNTIME_CONSUMER,
        ),
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
      runtimeConsumers,
      ...(defaultRuntimeState
        ? {
            runtimeStatus: defaultRuntimeState.status,
            runtimeConfigVersion: defaultRuntimeState.configVersion,
            runtimeObservedAt: defaultRuntimeState.observedAt,
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
    return [
      {
        id: row.id,
        guildId: row.guildId,
        pluginId: row.targetId,
        pluginName: manifest.name,
        event: row.event,
        eventLabel: presentation.eventLabel,
        sourceLabel: presentation.sourceLabel,
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
