import type { DiscordRoleLifecycleOperation, PrismaClient } from '@herta/db';
import type { Logger } from 'pino';
import {
  findHertaRoleReferences,
  removeStudioRolePolicyReference,
} from './discord-role-references.js';

const SCAN_INTERVAL_MS = 10_000;
const DUE_LIMIT = 50;
const STALE_RUNNING_MS = 15 * 60 * 1000;

interface RoleResult {
  id: string;
  name: string;
}

export interface DiscordRoleLifecycleRuntime {
  scanNow(now?: Date): Promise<void>;
  close(): Promise<void>;
}

export function startDiscordRoleLifecycleRuntime(input: {
  prisma: PrismaClient;
  logger: Logger;
  botHealthUrl: string;
  internalApiSecret: string;
}): DiscordRoleLifecycleRuntime {
  let scanning = false;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;

  const scanNow = async (now = new Date()): Promise<void> => {
    if (scanning || closed) return;
    scanning = true;
    try {
      await recoverStaleOperations(input.prisma, now, input.logger);
      const due = await input.prisma.discordRoleLifecycleOperation.findMany({
        where: { status: 'pending', executeAt: { lte: now } },
        orderBy: { executeAt: 'asc' },
        take: DUE_LIMIT,
      });
      for (const operation of due) {
        const claim = await input.prisma.discordRoleLifecycleOperation.updateMany({
          where: { id: operation.id, status: 'pending' },
          data: { status: 'running', startedAt: now, lastError: null },
        });
        if (claim.count === 0) continue;
        try {
          if (operation.operationType === 'create') {
            await executeCreate(input, operation, now);
          } else if (operation.operationType === 'delete') {
            await executeDelete(input, operation, now);
          } else {
            await markFailed(input.prisma, operation.id, 'UnsupportedOperationType');
          }
        } catch (error) {
          const ambiguousCreate = operation.operationType === 'create' && isTransportError(error);
          await input.prisma.discordRoleLifecycleOperation.update({
            where: { id: operation.id },
            data: {
              status: ambiguousCreate ? 'attention' : 'failed',
              lastError: resolveErrorName(error),
            },
          });
          await recordAudit(input.prisma, {
            guildId: operation.guildId,
            actorId: operation.createdBy,
            event: ambiguousCreate
              ? 'discord_role.lifecycle_attention'
              : 'discord_role.lifecycle_failed',
            targetId: operation.id,
            changes: { operationType: operation.operationType, errorName: resolveErrorName(error) },
          });
          input.logger.warn(
            {
              guildId: operation.guildId,
              operationId: operation.id,
              operationType: operation.operationType,
              errorName: resolveErrorName(error),
            },
            'Discord Role lifecycle operationの実行に失敗しました',
          );
        }
      }
    } finally {
      scanning = false;
    }
  };

  void scanNow();
  timer = setInterval(() => void scanNow(), SCAN_INTERVAL_MS);
  timer.unref();
  return {
    scanNow,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      while (scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}

async function executeCreate(
  input: { prisma: PrismaClient; botHealthUrl: string; internalApiSecret: string },
  operation: DiscordRoleLifecycleOperation,
  now: Date,
): Promise<void> {
  if (!operation || operation.roleColor === null) throw new Error('RoleCreatePayloadMissing');
  const role = await callCreateRole(input, operation.guildId, {
    name: operation.roleName,
    color: operation.roleColor,
    hoist: operation.hoist,
    mentionable: operation.mentionable,
  });
  await input.prisma.$transaction(async (tx) => {
    await tx.discordRoleLifecycleOperation.update({
      where: { id: operation.id },
      data: { status: 'completed', roleId: role.id, completedAt: now, lastError: null },
    });
    if (operation.expiresAt) {
      await tx.discordRoleLifecycleOperation.upsert({
        where: {
          guildId_idempotencyKey: {
            guildId: operation.guildId,
            idempotencyKey: `expire:${operation.id}`,
          },
        },
        create: {
          guildId: operation.guildId,
          operationType: 'delete',
          status: 'pending',
          executeAt: operation.expiresAt,
          roleId: role.id,
          roleName: role.name,
          createdBy: operation.createdBy,
          idempotencyKey: `expire:${operation.id}`,
          sourceOperationId: operation.id,
        },
        update: {},
      });
    }
    await tx.auditLog.create({
      data: {
        guildId: operation.guildId,
        actorId: 'herta-worker',
        actorType: 'system',
        event: 'discord_role.created',
        targetType: 'discord_role',
        targetId: role.id,
        changes: {
          roleName: role.name,
          scheduled: true,
          expiresAt: operation.expiresAt?.toISOString() ?? null,
        },
        severity: 'warning',
        metadata: {
          operationSource: 'worker',
          originalActorId: operation.createdBy,
          lifecycleOperationId: operation.id,
        },
      },
    });
  });
}

async function executeDelete(
  input: { prisma: PrismaClient; botHealthUrl: string; internalApiSecret: string },
  operation: DiscordRoleLifecycleOperation,
  now: Date,
): Promise<void> {
  if (!operation.roleId) throw new Error('RoleDeleteTargetMissing');
  const references = await findHertaRoleReferences(
    input.prisma,
    operation.guildId,
    operation.roleId,
  );
  if (references.length > 0) {
    throw new Error(`RoleStillReferencedByHertaConfig:${references.join(',')}`);
  }
  const result = await callDeleteRole(input, operation.guildId, operation.roleId);
  await input.prisma.$transaction(async (tx) => {
    await removeStudioRolePolicyReference(tx, operation.guildId, operation.roleId);
    await tx.discordRoleLifecycleOperation.update({
      where: { id: operation.id },
      data: { status: 'completed', completedAt: now, lastError: null },
    });
    await tx.auditLog.create({
      data: {
        guildId: operation.guildId,
        actorId: 'herta-worker',
        actorType: 'system',
        event: 'discord_role.deleted',
        targetType: 'discord_role',
        targetId: operation.roleId,
        changes: {
          roleName: result.roleName ?? operation.roleName,
          scheduled: true,
          alreadyMissing: !result.deleted,
        },
        severity: 'warning',
        metadata: {
          operationSource: 'worker',
          originalActorId: operation.createdBy,
          lifecycleOperationId: operation.id,
        },
      },
    });
  });
}

async function recoverStaleOperations(
  prisma: PrismaClient,
  now: Date,
  logger: Logger,
): Promise<void> {
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS);
  const createResult = await prisma.discordRoleLifecycleOperation.updateMany({
    where: { status: 'running', operationType: 'create', startedAt: { lt: staleBefore } },
    data: { status: 'attention', lastError: 'StaleCreateRequiresReview' },
  });
  const deleteResult = await prisma.discordRoleLifecycleOperation.updateMany({
    where: { status: 'running', operationType: 'delete', startedAt: { lt: staleBefore } },
    data: { status: 'pending', startedAt: null, lastError: 'RecoveredStaleDelete' },
  });
  if (createResult.count || deleteResult.count) {
    logger.warn(
      { createAttention: createResult.count, deleteRecovered: deleteResult.count },
      '停止中だったRole lifecycle operationを復旧しました',
    );
  }
}

async function callCreateRole(
  input: { botHealthUrl: string; internalApiSecret: string },
  guildId: string,
  body: object,
): Promise<RoleResult> {
  const response = await roleApiRequest(input, `/internal/guilds/${guildId}/roles`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: RoleResult;
    status?: string;
  } | null;
  if (!response.ok || !payload?.result)
    throw new Error(payload?.status ?? `RoleCreateHttp${response.status}`);
  return payload.result;
}

async function callDeleteRole(
  input: { botHealthUrl: string; internalApiSecret: string },
  guildId: string,
  roleId: string,
): Promise<{ deleted: boolean; roleName: string | null }> {
  const response = await roleApiRequest(input, `/internal/guilds/${guildId}/roles/${roleId}`, {
    method: 'DELETE',
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: { deleted: boolean; roleName: string | null };
    status?: string;
  } | null;
  if (!response.ok || !payload?.result)
    throw new Error(payload?.status ?? `RoleDeleteHttp${response.status}`);
  return payload.result;
}

async function roleApiRequest(
  input: { botHealthUrl: string; internalApiSecret: string },
  path: string,
  init: RequestInit,
): Promise<Response> {
  let endpoint: URL;
  try {
    endpoint = new URL(path, input.botHealthUrl);
  } catch {
    throw new RoleLifecycleTransportError('InvalidBotHealthUrl');
  }
  try {
    return await fetch(endpoint, {
      ...init,
      headers: {
        Authorization: `Bearer ${input.internalApiSecret}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new RoleLifecycleTransportError('BotInternalApiTransportUnknown');
  }
}

class RoleLifecycleTransportError extends Error {}

function isTransportError(error: unknown): boolean {
  return error instanceof RoleLifecycleTransportError;
}

async function markFailed(prisma: PrismaClient, id: string, errorName: string): Promise<void> {
  await prisma.discordRoleLifecycleOperation.update({
    where: { id },
    data: { status: 'failed', lastError: errorName },
  });
}

async function recordAudit(
  prisma: PrismaClient,
  input: { guildId: string; actorId: string; event: string; targetId: string; changes: object },
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      guildId: input.guildId,
      actorId: 'herta-worker',
      actorType: 'system',
      event: input.event,
      targetType: 'discord_role_lifecycle_operation',
      targetId: input.targetId,
      changes: input.changes,
      severity: 'warning',
      metadata: { operationSource: 'worker', originalActorId: input.actorId },
    },
  });
}

function resolveErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  return (error.name !== 'Error' ? error.name : error.message || 'Error').slice(0, 160);
}
