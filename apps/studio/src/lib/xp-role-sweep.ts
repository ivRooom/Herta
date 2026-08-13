import { randomUUID } from 'node:crypto';
import type { XpRoleSweepReason } from '@herta/shared';
import { prisma } from '@/lib/db';
import { publishXpRoleSweepEvent } from '@/lib/plugin-runtime-events';

const SWEEP_EVENTS = [
  'leaderboard.xp_role_sweep_requested',
  'leaderboard.xp_role_sweep_completed',
  'leaderboard.xp_role_sweep_failed',
] as const;

export interface XpRoleSweepRequestResult {
  requestId: string;
  queued: boolean;
}

export interface XpRoleSweepStatus {
  requestId: string;
  status: 'queued' | 'completed' | 'failed';
  reason: string | null;
  createdAt: string;
  result: Record<string, unknown> | null;
}

export async function requestXpRoleSweep(input: {
  guildId: string;
  actorId: string;
  reason: XpRoleSweepReason;
  note?: string | null;
}): Promise<XpRoleSweepRequestResult> {
  const requestId = randomUUID();
  await prisma.auditLog.create({
    data: {
      guildId: input.guildId,
      actorId: input.actorId,
      event: 'leaderboard.xp_role_sweep_requested',
      targetType: 'guild',
      targetId: input.guildId,
      metadata: {
        requestId,
        reason: input.reason,
        note: input.note?.trim() || null,
        operationSource: 'dashboard',
      },
    },
  });

  const queued = await publishXpRoleSweepEvent({
    requestId,
    guildId: input.guildId,
    actorId: input.actorId,
    reason: input.reason,
  });

  if (!queued) {
    await prisma.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'leaderboard.xp_role_sweep_failed',
        targetType: 'guild',
        targetId: input.guildId,
        severity: 'warning',
        metadata: {
          requestId,
          reason: input.reason,
          operationSource: 'dashboard',
          failureCode: 'bot_not_subscribed',
        },
      },
    });
  }

  return { requestId, queued };
}

export async function getLatestXpRoleSweepStatus(
  guildId: string,
): Promise<XpRoleSweepStatus | null> {
  const row = await prisma.auditLog.findFirst({
    where: { guildId, event: { in: [...SWEEP_EVENTS] } },
    orderBy: { createdAt: 'desc' },
    select: { event: true, metadata: true, createdAt: true },
  });
  if (!row) return null;

  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const requestId = typeof metadata.requestId === 'string' ? metadata.requestId : '';
  if (!requestId) return null;

  return {
    requestId,
    status:
      row.event === 'leaderboard.xp_role_sweep_completed'
        ? 'completed'
        : row.event === 'leaderboard.xp_role_sweep_failed'
          ? 'failed'
          : 'queued',
    reason: typeof metadata.reason === 'string' ? metadata.reason : null,
    createdAt: row.createdAt.toISOString(),
    result: isRecord(metadata.result) ? metadata.result : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
