import {
  claimDiscordRoleOperation,
  enqueueDiscordRoleDeleteOperation,
  listDueDiscordRoleOperations,
  markDiscordRoleOperationFailed,
  markDiscordRoleOperationSucceeded,
  recoverStaleDiscordRoleOperations,
  removeStudioRolePolicyForDeletedDiscordRole,
  rescheduleDiscordRoleDeleteOperation,
  type DiscordRoleOperationRecord,
  type PrismaClient,
} from '@herta/db';
import type { Logger } from '@herta/logger';

const DEFAULT_SCAN_INTERVAL_SECONDS = 15;
const MIN_SCAN_INTERVAL_SECONDS = 5;
const MAX_SCAN_INTERVAL_SECONDS = 300;
const STALE_CLAIM_MS = 5 * 60_000;
const MAX_DELETE_ATTEMPTS = 5;
const MAX_BATCH_SIZE = 25;
const INTERNAL_REQUEST_TIMEOUT_MS = 30_000;

export interface DiscordRoleOperationRuntime {
  scanNow(): Promise<void>;
  close(): Promise<void>;
}

export interface StartDiscordRoleOperationRuntimeOptions {
  prisma: PrismaClient;
  logger: Logger;
  botHealthUrl: string;
  internalApiSecret: string;
  scanIntervalSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface InternalRoleResult {
  id: string;
  name: string;
  color: number;
}

class BotRoleMutationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'BotRoleMutationError';
  }
}

export async function startDiscordRoleOperationRuntime(
  options: StartDiscordRoleOperationRuntimeOptions,
): Promise<DiscordRoleOperationRuntime> {
  const baseUrl = resolveBotInternalBaseUrl(options.botHealthUrl);
  const secret = options.internalApiSecret.trim();
  if (secret.length < 32) throw new Error('BOT_INTERNAL_API_SECRET must be at least 32 characters');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const intervalMs = normalizeRoleOperationScanIntervalSeconds(options.scanIntervalSeconds) * 1_000;
  let timer: NodeJS.Timeout | undefined;
  let activeCycle: Promise<void> | null = null;
  let closed = false;

  const scanNow = async (): Promise<void> => {
    if (closed) return;
    if (activeCycle) return activeCycle;
    activeCycle = runRoleOperationCycle({
      prisma: options.prisma,
      logger: options.logger,
      baseUrl,
      secret,
      fetchImpl,
      now,
    }).finally(() => {
      activeCycle = null;
    });
    return activeCycle;
  };

  await scanNow();
  timer = setInterval(() => {
    void scanNow().catch((error) => {
      options.logger.error(
        { errorName: resolveErrorName(error) },
        'Discord Role Operation Workerのcycleに失敗しました',
      );
    });
  }, intervalMs);
  timer.unref();

  return {
    scanNow,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await activeCycle;
    },
  };
}

export function normalizeRoleOperationScanIntervalSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SCAN_INTERVAL_SECONDS;
  return Math.max(
    MIN_SCAN_INTERVAL_SECONDS,
    Math.min(MAX_SCAN_INTERVAL_SECONDS, Math.trunc(value ?? DEFAULT_SCAN_INTERVAL_SECONDS)),
  );
}

export function computeRoleDeleteRetryAt(now: Date, attemptCount: number): Date {
  const safeAttempt = Math.max(1, Math.min(MAX_DELETE_ATTEMPTS, Math.trunc(attemptCount)));
  const delayMs = Math.min(15_000 * 2 ** (safeAttempt - 1), 15 * 60_000);
  return new Date(now.getTime() + delayMs);
}

async function runRoleOperationCycle(input: {
  prisma: PrismaClient;
  logger: Logger;
  baseUrl: URL;
  secret: string;
  fetchImpl: typeof fetch;
  now: () => Date;
}): Promise<void> {
  const cycleNow = input.now();
  const recovered = await recoverStaleDiscordRoleOperations(
    input.prisma,
    new Date(cycleNow.getTime() - STALE_CLAIM_MS),
    cycleNow,
  );
  if (recovered.createFailed > 0 || recovered.deleteRequeued > 0) {
    input.logger.warn(recovered, 'staleなDiscord Role Operationをreconcileしました');
  }

  const due = await listDueDiscordRoleOperations(input.prisma, cycleNow, MAX_BATCH_SIZE);
  for (const candidate of due) {
    const claimed = await claimDiscordRoleOperation(input.prisma, candidate.id, input.now());
    if (!claimed) continue;
    if (claimed.operation === 'create') {
      await processCreateOperation(input, claimed);
    } else {
      await processDeleteOperation(input, claimed);
    }
  }
}

async function processCreateOperation(
  input: {
    prisma: PrismaClient;
    logger: Logger;
    baseUrl: URL;
    secret: string;
    fetchImpl: typeof fetch;
    now: () => Date;
  },
  operation: DiscordRoleOperationRecord,
): Promise<void> {
  if (!operation.roleName || operation.roleColor === null) {
    await failOperation(input, operation, 'InvalidStoredDiscordRoleCreatePayload');
    return;
  }

  let role: InternalRoleResult;
  try {
    role = await createRoleViaBot(input.baseUrl, input.secret, operation, input.fetchImpl);
  } catch (error) {
    // createは応答喪失時にDiscord側だけ成功している可能性があるため自動再試行しない。
    await failOperation(input, operation, resolveErrorName(error));
    return;
  }

  const completedAt = input.now();
  try {
    await input.prisma.$transaction(async (tx) => {
      await markDiscordRoleOperationSucceeded(tx, operation.id, completedAt, role.id);
      if (operation.expiresAfterSeconds !== null) {
        await enqueueDiscordRoleDeleteOperation(tx, {
          guildId: operation.guildId,
          discordRoleId: role.id,
          roleName: role.name,
          scheduledFor: new Date(completedAt.getTime() + operation.expiresAfterSeconds * 1_000),
          createdBy: operation.createdBy,
          source: 'temporary-expiry',
          parentOperationId: operation.id,
        });
      }
      await tx.auditLog.create({
        data: {
          guildId: operation.guildId,
          actorId: operation.createdBy,
          event: 'discord_role.created',
          targetType: 'discord_role',
          targetId: role.id,
          changes: {
            roleName: role.name,
            roleColor: role.color,
            scheduledFor: operation.scheduledFor.toISOString(),
            expiresAfterSeconds: operation.expiresAfterSeconds,
          },
          severity: 'warning',
          metadata: {
            operationSource: 'worker',
            roleOperationId: operation.id,
            requestedVia: operation.source,
            securitySensitive: true,
          },
        },
      });
    });
    input.logger.info(
      { guildId: operation.guildId, roleId: role.id, operationId: operation.id },
      'Discord Roleを作成しました',
    );
  } catch (persistenceError) {
    await compensateFailedCreatePersistence(input, operation, role, persistenceError);
  }
}

async function compensateFailedCreatePersistence(
  input: {
    prisma: PrismaClient;
    logger: Logger;
    baseUrl: URL;
    secret: string;
    fetchImpl: typeof fetch;
    now: () => Date;
  },
  operation: DiscordRoleOperationRecord,
  role: InternalRoleResult,
  persistenceError: unknown,
): Promise<void> {
  const persistenceErrorName = resolveErrorName(persistenceError);
  let compensationErrorName: string | null = null;

  try {
    await deleteRoleViaBot(
      input.baseUrl,
      input.secret,
      { ...operation, discordRoleId: role.id },
      input.fetchImpl,
    );
  } catch (compensationError) {
    compensationErrorName = resolveErrorName(compensationError);
    input.logger.error(
      {
        guildId: operation.guildId,
        roleId: role.id,
        operationId: operation.id,
        persistenceErrorName,
        compensationErrorName,
      },
      'Discord Role作成後のDB確定と補償削除の両方に失敗しました',
    );
  }

  const errorName = compensationErrorName
    ? 'DiscordRoleCreatePersistenceFailedCompensationFailed'
    : 'DiscordRoleCreatePersistenceFailedCompensated';
  await failOperation(input, operation, errorName, role.id, {
    persistenceErrorName,
    ...(compensationErrorName ? { compensationErrorName } : {}),
  });
}

async function processDeleteOperation(
  input: {
    prisma: PrismaClient;
    logger: Logger;
    baseUrl: URL;
    secret: string;
    fetchImpl: typeof fetch;
    now: () => Date;
  },
  operation: DiscordRoleOperationRecord,
): Promise<void> {
  if (!operation.discordRoleId) {
    await failOperation(input, operation, 'InvalidStoredDiscordRoleDeletePayload');
    return;
  }

  try {
    await deleteRoleViaBot(input.baseUrl, input.secret, operation, input.fetchImpl);
    const completedAt = input.now();
    await input.prisma.$transaction(async (tx) => {
      await markDiscordRoleOperationSucceeded(tx, operation.id, completedAt);
      await removeStudioRolePolicyForDeletedDiscordRole(
        tx,
        operation.guildId,
        operation.discordRoleId!,
      );
      await tx.auditLog.create({
        data: {
          guildId: operation.guildId,
          actorId: operation.createdBy,
          event: 'discord_role.deleted',
          targetType: 'discord_role',
          targetId: operation.discordRoleId,
          changes: {
            roleName: operation.roleName,
            scheduledFor: operation.scheduledFor.toISOString(),
          },
          severity: 'warning',
          metadata: {
            operationSource: 'worker',
            roleOperationId: operation.id,
            requestedVia: operation.source,
            securitySensitive: true,
          },
        },
      });
    });
    input.logger.info(
      {
        guildId: operation.guildId,
        roleId: operation.discordRoleId,
        operationId: operation.id,
      },
      'Discord Roleを削除しました',
    );
  } catch (error) {
    const errorName = resolveErrorName(error);
    if (operation.attemptCount < MAX_DELETE_ATTEMPTS && isRetryableDeleteError(error)) {
      const retryAt = computeRoleDeleteRetryAt(input.now(), operation.attemptCount);
      await rescheduleDiscordRoleDeleteOperation(input.prisma, operation.id, retryAt, errorName);
      input.logger.warn(
        {
          guildId: operation.guildId,
          roleId: operation.discordRoleId,
          operationId: operation.id,
          attemptCount: operation.attemptCount,
          retryAt: retryAt.toISOString(),
          errorName,
        },
        'Discord Role削除を再試行します',
      );
      return;
    }
    await failOperation(input, operation, errorName);
  }
}

async function failOperation(
  input: { prisma: PrismaClient; logger: Logger; now: () => Date },
  operation: DiscordRoleOperationRecord,
  errorName: string,
  discordRoleId: string | null = operation.discordRoleId,
  details: Record<string, string> = {},
): Promise<void> {
  const failedAt = input.now();
  await markDiscordRoleOperationFailed(
    input.prisma,
    operation.id,
    failedAt,
    errorName,
    discordRoleId,
  );
  await input.prisma.auditLog.create({
    data: {
      guildId: operation.guildId,
      actorId: operation.createdBy,
      event: `discord_role.${operation.operation}_failed`,
      targetType: 'discord_role',
      targetId: discordRoleId ?? operation.id,
      changes: {
        errorName: errorName.slice(0, 120),
        attemptCount: operation.attemptCount,
        ...details,
      },
      severity: 'error',
      metadata: {
        operationSource: 'worker',
        roleOperationId: operation.id,
        requestedVia: operation.source,
        securitySensitive: true,
      },
    },
  });
  input.logger.error(
    {
      guildId: operation.guildId,
      roleId: discordRoleId,
      operationId: operation.id,
      operation: operation.operation,
      errorName,
      ...details,
    },
    'Discord Role Operationが失敗しました',
  );
}

async function createRoleViaBot(
  baseUrl: URL,
  secret: string,
  operation: DiscordRoleOperationRecord,
  fetchImpl: typeof fetch,
): Promise<InternalRoleResult> {
  const response = await fetchImpl(
    new URL(`/internal/guilds/${operation.guildId}/roles`, baseUrl),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: operation.roleName,
        color: operation.roleColor,
        operationId: operation.id,
      }),
      signal: AbortSignal.timeout(INTERNAL_REQUEST_TIMEOUT_MS),
    },
  );
  const payload = await readInternalPayload(response);
  if (!response.ok)
    throw new BotRoleMutationError(response.status, payload.status ?? 'bot_role_create_failed');
  const role = payload.role;
  if (!isRoleResult(role)) throw new BotRoleMutationError(502, 'malformed_bot_role_response');
  return role;
}

async function deleteRoleViaBot(
  baseUrl: URL,
  secret: string,
  operation: DiscordRoleOperationRecord,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(
    new URL(`/internal/guilds/${operation.guildId}/roles/${operation.discordRoleId!}`, baseUrl),
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
        'X-Herta-Operation-Id': operation.id,
      },
      signal: AbortSignal.timeout(INTERNAL_REQUEST_TIMEOUT_MS),
    },
  );
  const payload = await readInternalPayload(response);
  if (!response.ok)
    throw new BotRoleMutationError(response.status, payload.status ?? 'bot_role_delete_failed');
}

function resolveBotInternalBaseUrl(raw: string): URL {
  const url = new URL(raw.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BOT_HEALTH_URL must use http or https');
  }
  url.pathname = url.pathname.replace(/\/healthz\/?$/u, '/');
  url.search = '';
  url.hash = '';
  return url;
}

async function readInternalPayload(response: Response): Promise<{
  status?: string;
  role?: unknown;
}> {
  const value = await response.json().catch(() => null);
  if (!isRecord(value)) return {};
  return {
    status: typeof value.status === 'string' ? value.status.slice(0, 120) : undefined,
    role: value.role,
  };
}

function isRetryableDeleteError(error: unknown): boolean {
  if (!(error instanceof BotRoleMutationError)) return true;
  return error.status === 429 || error.status >= 500;
}

function isRoleResult(value: unknown): value is InternalRoleResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    /^\d{17,20}$/u.test(value.id) &&
    typeof value.name === 'string' &&
    typeof value.color === 'number' &&
    Number.isInteger(value.color)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveErrorName(error: unknown): string {
  if (error instanceof BotRoleMutationError) return error.code.slice(0, 120);
  if (!(error instanceof Error)) return 'UnknownError';
  if (error.name.trim() && error.name !== 'Error') return error.name.slice(0, 120);
  return (error.message.trim() || 'Error').slice(0, 120);
}
