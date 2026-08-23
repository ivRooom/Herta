import { getPrismaClient, type Prisma, type PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import { defaultPluginRuntimeState, type PluginRuntimeState } from './runtime-state.js';

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

const startupReconciledGuilds = new Set<string>();
const startupReconciliationInFlightGuilds = new Set<string>();

export interface PluginRuntimeStartupTarget {
  pluginId: string;
  enabled: boolean;
  configVersion: number;
}

export interface PluginRuntimeStartupAuditRow {
  targetId: string | null;
  event: string;
  metadata: unknown;
  createdAt: Date;
}

export interface PluginRuntimeRecoveryCandidate extends PluginRuntimeStartupTarget {
  recoveredFrom: Exclude<RuntimeStatus, 'applied'>;
  eventId?: string;
}

export function selectPluginRuntimeRecoveryCandidates(
  guildId: string,
  targets: readonly PluginRuntimeStartupTarget[],
  auditRows: readonly PluginRuntimeStartupAuditRow[],
  runtimeState: PluginRuntimeState,
): PluginRuntimeRecoveryCandidate[] {
  const latestStates = buildLatestRuntimeStates(auditRows);
  const candidates: PluginRuntimeRecoveryCandidate[] = [];

  for (const target of targets) {
    const latest = latestStates.get(runtimeStateKey(target.pluginId, target.configVersion));
    if (!latest || latest.status === 'applied') continue;
    if (
      !runtimeState.isTargetApplied(guildId, target.pluginId, target.configVersion, target.enabled)
    ) {
      continue;
    }
    candidates.push({
      ...target,
      recoveredFrom: latest.status,
      ...(latest.eventId ? { eventId: latest.eventId } : {}),
    });
  }

  return candidates;
}

/**
 * Guild Commandの初回同期成功後だけstartup reconciliationを実行する。
 * Runtimeイベントによる後続resyncでは通常ACK側へ任せるが、一時的なDB/Audit障害時は
 * 次回の成功したGuild同期でrecovery判定を再試行できるようにする。
 */
export async function reconcilePluginRuntimeStartupOnce(
  guildId: string,
  logger: Logger,
): Promise<void> {
  if (startupReconciledGuilds.has(guildId) || startupReconciliationInFlightGuilds.has(guildId)) {
    return;
  }

  startupReconciliationInFlightGuilds.add(guildId);
  try {
    const succeeded = await reconcilePluginRuntimeStartup(getPrismaClient(), guildId, logger);
    if (succeeded) startupReconciledGuilds.add(guildId);
  } finally {
    startupReconciliationInFlightGuilds.delete(guildId);
  }
}

export async function reconcilePluginRuntimeStartup(
  prisma: PrismaClient,
  guildId: string,
  logger: Logger,
  runtimeState: PluginRuntimeState = defaultPluginRuntimeState,
): Promise<boolean> {
  if (!process.env['DATABASE_URL']) return true;

  try {
    const targets = await prisma.guildPlugin.findMany({
      where: { guildId },
      select: { pluginId: true, enabled: true, configVersion: true },
    });
    if (targets.length === 0) return true;

    const auditRows = await prisma.auditLog.findMany({
      where: {
        guildId,
        targetType: 'plugin',
        targetId: { in: targets.map((target) => target.pluginId) },
        event: { in: [...RUNTIME_AUDIT_EVENTS] },
        OR: targets.map((target) => ({
          targetId: target.pluginId,
          metadata: {
            path: ['configVersion'],
            equals: target.configVersion,
          },
        })),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { targetId: true, event: true, metadata: true, createdAt: true },
    });

    const candidates = selectPluginRuntimeRecoveryCandidates(
      guildId,
      targets,
      auditRows,
      runtimeState,
    );
    if (candidates.length === 0) return true;

    await prisma.$transaction(
      candidates.map((candidate) =>
        prisma.auditLog.create({
          data: createStartupRecoveryAuditData(guildId, candidate),
        }),
      ),
    );
    logger.info(
      { guildId, plugins: candidates.map((candidate) => candidate.pluginId) },
      'Plugin Runtime startup recovery ACKを記録しました',
    );
    return true;
  } catch (error) {
    logger.error(
      { guildId, errorName: resolveErrorName(error) },
      'Plugin Runtime startup recoveryの監査処理に失敗しました',
    );
    return false;
  }
}

export function createStartupRecoveryAuditData(
  guildId: string,
  candidate: PluginRuntimeRecoveryCandidate,
): Prisma.AuditLogUncheckedCreateInput {
  return {
    guildId,
    actorId: 'herta-bot',
    actorType: 'service',
    event: 'plugin.runtime_apply_succeeded',
    targetType: 'plugin',
    targetId: candidate.pluginId,
    severity: 'info',
    metadata: {
      operationSource: 'bot-runtime-startup-recovery',
      recovery: true,
      recoveredFrom: candidate.recoveredFrom,
      ...(candidate.eventId ? { eventId: candidate.eventId } : {}),
      eventType: candidate.enabled ? 'enabled' : 'disabled',
      configVersion: candidate.configVersion,
    },
  };
}

function buildLatestRuntimeStates(
  rows: readonly PluginRuntimeStartupAuditRow[],
): Map<string, { status: RuntimeStatus; eventId?: string }> {
  const states = new Map<string, { status: RuntimeStatus; eventId?: string }>();

  for (const row of rows) {
    if (!row.targetId || !isRuntimeAuditEvent(row.event)) continue;
    const configVersion = readConfigVersion(row.metadata);
    if (configVersion === undefined) continue;
    const key = runtimeStateKey(row.targetId, configVersion);
    const status = RUNTIME_STATUS_BY_EVENT[row.event];
    const eventId = readEventId(row.metadata);
    const existing = states.get(key);
    if (!existing) {
      states.set(key, { status, eventId });
      continue;
    }

    // publish結果とBot ACKは別プロセスから書かれるためcreatedAt順が逆転し得る。
    // 同一eventIdではterminalなapply結果を優先する。
    if (
      eventId &&
      existing.eventId === eventId &&
      !isApplyStatus(existing.status) &&
      isApplyStatus(status)
    ) {
      states.set(key, { status, eventId });
    }
  }

  return states;
}

function runtimeStateKey(pluginId: string, configVersion: number): string {
  return `${pluginId}:${configVersion}`;
}

function isRuntimeAuditEvent(event: string): event is RuntimeAuditEvent {
  return RUNTIME_AUDIT_EVENTS.includes(event as RuntimeAuditEvent);
}

function isApplyStatus(status: RuntimeStatus): boolean {
  return status === 'applied' || status === 'apply_failed';
}

function readConfigVersion(metadata: unknown): number | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata['configVersion'];
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function readEventId(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata['eventId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name : 'UnknownError';
}
