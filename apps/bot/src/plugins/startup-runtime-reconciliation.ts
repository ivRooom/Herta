import { randomUUID } from 'node:crypto';
import { getPrismaClient } from '@herta/db';
import type { PluginRuntimeEvent } from '@herta/shared';
import type { PluginRuntimeState } from './runtime-state.js';

const RUNTIME_AUDIT_EVENTS = [
  'plugin.runtime_publish_succeeded',
  'plugin.runtime_publish_failed',
  'plugin.runtime_apply_succeeded',
  'plugin.runtime_apply_failed',
] as const;

type RuntimeAuditEvent = (typeof RUNTIME_AUDIT_EVENTS)[number];
type RuntimeStatus = 'published' | 'publish_failed' | 'applied' | 'apply_failed';

const RUNTIME_STATUS_BY_EVENT: Record<RuntimeAuditEvent, RuntimeStatus> = {
  'plugin.runtime_publish_succeeded': 'published',
  'plugin.runtime_publish_failed': 'publish_failed',
  'plugin.runtime_apply_succeeded': 'applied',
  'plugin.runtime_apply_failed': 'apply_failed',
};

export interface StartupRuntimePluginRow {
  pluginId: string;
  enabled: boolean;
  configVersion: number;
  updatedAt: Date;
}

export interface StartupRuntimeAuditRow {
  targetId: string | null;
  event: string;
  metadata: unknown;
  createdAt: Date;
}

export interface StartupRuntimeRecoveryAck {
  guildId: string;
  pluginId: string;
  configVersion: number;
  eventType: PluginRuntimeEvent['eventType'];
  sourceEventId: string;
}

export interface StartupRuntimeReconciliationStore {
  loadCurrentPlugins(guildId: string): Promise<StartupRuntimePluginRow[]>;
  loadRuntimeAuditRows(
    guildId: string,
    plugins: readonly StartupRuntimePluginRow[],
  ): Promise<StartupRuntimeAuditRow[]>;
  recordRecoveryAcks(acks: readonly StartupRuntimeRecoveryAck[]): Promise<void>;
}

interface RuntimeObservation {
  status: RuntimeStatus;
  eventId: string;
  eventType: PluginRuntimeEvent['eventType'];
}

export async function reconcileStartupPluginRuntime(
  guildId: string,
  runtimeState: PluginRuntimeState,
  store: StartupRuntimeReconciliationStore = createPrismaStartupRuntimeStore(),
): Promise<number> {
  const plugins = await store.loadCurrentPlugins(guildId);
  if (plugins.length === 0) return 0;

  const auditRows = await store.loadRuntimeAuditRows(guildId, plugins);
  const recoveryAcks: StartupRuntimeRecoveryAck[] = [];

  for (const plugin of plugins) {
    const observation = resolveCurrentRuntimeObservation(
      auditRows,
      plugin.pluginId,
      plugin.configVersion,
    );
    if (!observation || observation.status === 'applied') continue;
    if (!eventTypeMatchesCurrentState(observation.eventType, plugin.enabled)) continue;
    if (
      !runtimeState.isPluginStateApplied(
        guildId,
        plugin.pluginId,
        plugin.configVersion,
        plugin.enabled,
      )
    ) {
      continue;
    }

    recoveryAcks.push({
      guildId,
      pluginId: plugin.pluginId,
      configVersion: plugin.configVersion,
      eventType: observation.eventType,
      sourceEventId: observation.eventId,
    });
  }

  if (recoveryAcks.length === 0) return 0;
  await store.recordRecoveryAcks(recoveryAcks);
  return recoveryAcks.length;
}

export function resolveCurrentRuntimeObservation(
  rows: readonly StartupRuntimeAuditRow[],
  pluginId: string,
  configVersion: number,
): RuntimeObservation | undefined {
  let observation: RuntimeObservation | undefined;

  for (const row of rows) {
    if (row.targetId !== pluginId || !isRuntimeAuditEvent(row.event)) continue;
    const metadata = runtimeMetadata(row.metadata);
    if (!metadata || metadata.configVersion !== configVersion) continue;

    const status = RUNTIME_STATUS_BY_EVENT[row.event];
    const candidate: RuntimeObservation = {
      status,
      eventId: metadata.eventId,
      eventType: metadata.eventType,
    };
    if (!observation) {
      observation = candidate;
      continue;
    }

    if (
      observation.eventId === candidate.eventId &&
      !isApplyOutcome(observation.status) &&
      isApplyOutcome(candidate.status)
    ) {
      observation = candidate;
    }
  }

  return observation;
}

function createPrismaStartupRuntimeStore(): StartupRuntimeReconciliationStore {
  const prisma = getPrismaClient();
  return {
    async loadCurrentPlugins(guildId) {
      if (!process.env['DATABASE_URL']) return [];
      return prisma.guildPlugin.findMany({
        where: { guildId },
        select: { pluginId: true, enabled: true, configVersion: true, updatedAt: true },
      });
    },
    async loadRuntimeAuditRows(guildId, plugins) {
      if (!process.env['DATABASE_URL'] || plugins.length === 0) return [];
      return prisma.auditLog.findMany({
        where: {
          guildId,
          targetType: 'plugin',
          event: { in: [...RUNTIME_AUDIT_EVENTS] },
          OR: plugins.map((plugin) => ({
            targetId: plugin.pluginId,
            createdAt: { gte: plugin.updatedAt },
          })),
        },
        select: { targetId: true, event: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
    },
    async recordRecoveryAcks(acks) {
      if (!process.env['DATABASE_URL'] || acks.length === 0) return;
      await prisma.$transaction(
        acks.map((ack) =>
          prisma.auditLog.create({
            data: {
              guildId: ack.guildId,
              actorId: 'herta-bot',
              actorType: 'service',
              event: 'plugin.runtime_apply_succeeded',
              targetType: 'plugin',
              targetId: ack.pluginId,
              severity: 'info',
              metadata: {
                operationSource: 'bot-runtime',
                recoverySource: 'startup',
                eventId: `startup-recovery:${randomUUID()}`,
                sourceEventId: ack.sourceEventId,
                eventType: ack.eventType,
                configVersion: ack.configVersion,
                attempts: 1,
              },
            },
          }),
        ),
      );
    },
  };
}

function runtimeMetadata(metadata: unknown): {
  configVersion: number;
  eventId: string;
  eventType: PluginRuntimeEvent['eventType'];
} | null {
  if (!isRecord(metadata)) return null;
  const configVersion = metadata['configVersion'];
  const eventId = metadata['eventId'];
  const eventType = metadata['eventType'];
  if (!Number.isSafeInteger(configVersion) || Number(configVersion) < 0) return null;
  if (typeof eventId !== 'string' || eventId.length === 0) return null;
  if (!isPluginRuntimeEventType(eventType)) return null;
  return { configVersion: Number(configVersion), eventId, eventType };
}

function eventTypeMatchesCurrentState(
  eventType: PluginRuntimeEvent['eventType'],
  enabled: boolean,
): boolean {
  return enabled ? eventType === 'enabled' || eventType === 'config_updated' : eventType === 'disabled';
}

function isPluginRuntimeEventType(value: unknown): value is PluginRuntimeEvent['eventType'] {
  return value === 'enabled' || value === 'disabled' || value === 'config_updated';
}

function isRuntimeAuditEvent(value: string): value is RuntimeAuditEvent {
  return (RUNTIME_AUDIT_EVENTS as readonly string[]).includes(value);
}

function isApplyOutcome(status: RuntimeStatus): boolean {
  return status === 'applied' || status === 'apply_failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
