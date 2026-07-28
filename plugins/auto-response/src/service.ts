import {
  AutoResponseValidationError,
  assertDiscordId,
  assertRuleId,
  normalizeAutoResponseRuleInput,
  type AutoResponseConfig,
  type AutoResponseMatchMode,
  type AutoResponseResponseType,
  type AutoResponseRuleInput,
  type NormalizedAutoResponseRuleInput,
} from './config.js';

export type AutoResponseOperationSource = 'dashboard' | 'discord';
export type AutoResponseExecutionStatus = 'success' | 'failure' | 'skipped';
export type AutoResponseClaimResult =
  | 'claimed'
  | 'guild_cooldown'
  | 'rule_cooldown'
  | 'unavailable';

export interface AutoResponseRuleRecord extends NormalizedAutoResponseRuleInput {
  id: string;
  guildId: string;
  triggerType: string;
  responseCount: number;
  failureCount: number;
  lastTriggeredAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutoResponseStats {
  successCount: number;
  failureCount: number;
  skippedCount: number;
  averageDurationMs: number;
}

interface AutoResponseDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<AutoResponseRuleRecord>;
  delete(args: Record<string, unknown>): Promise<AutoResponseRuleRecord>;
  findFirst(args: Record<string, unknown>): Promise<AutoResponseRuleRecord | null>;
  findMany(args: Record<string, unknown>): Promise<AutoResponseRuleRecord[]>;
  update(args: Record<string, unknown>): Promise<AutoResponseRuleRecord>;
}

interface AutoResponseExecutionEventRecord {
  id: string;
  guildId: string;
  ruleId: string;
  status: string;
  durationMs: number;
  errorName: string | null;
  executedAt: Date;
}

interface AutoResponseExecutionEventDelegate {
  aggregate(args: Record<string, unknown>): Promise<{ _avg: { durationMs: number | null } }>;
  count(args: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<AutoResponseExecutionEventRecord>;
  deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
  findFirst(args: Record<string, unknown>): Promise<AutoResponseExecutionEventRecord | null>;
}

interface AuditLogDelegate {
  create(args: Record<string, unknown>): Promise<unknown>;
}

export interface AutoResponseTransactionClient {
  autoResponse: AutoResponseDelegate;
  autoResponseExecutionEvent: AutoResponseExecutionEventDelegate;
  auditLog: AuditLogDelegate;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export interface AutoResponsePrismaClient extends AutoResponseTransactionClient {
  $transaction<T>(callback: (tx: AutoResponseTransactionClient) => Promise<T>): Promise<T>;
}

export interface CreateAutoResponseRuleInput {
  guildId: string;
  actorId: string;
  source: AutoResponseOperationSource;
  config: AutoResponseConfig;
  rule: AutoResponseRuleInput;
}

export interface UpdateAutoResponseRuleInput {
  guildId: string;
  ruleId: string;
  actorId: string;
  source: AutoResponseOperationSource;
  config: AutoResponseConfig;
  patch: Partial<AutoResponseRuleInput>;
}

export interface ListAutoResponseRulesInput {
  guildId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  matchMode?: AutoResponseMatchMode;
  responseType?: AutoResponseResponseType;
  enabled?: boolean;
}

export interface ListAutoResponseRulesResult {
  items: AutoResponseRuleRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RecordAutoResponseExecutionInput {
  guildId: string;
  ruleId: string;
  status: AutoResponseExecutionStatus;
  durationMs: number;
  errorName?: string | null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;
export const AUTO_RESPONSE_EXECUTION_RETENTION_DAYS = 90;

export async function createAutoResponseRule(
  prisma: AutoResponsePrismaClient,
  input: CreateAutoResponseRuleInput,
): Promise<AutoResponseRuleRecord> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertDiscordId(input.actorId, '操作ユーザーID');
  const normalized = normalizeAutoResponseRuleInput(input.rule, input.config);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
    const count = await tx.autoResponse.count({ where: { guildId: input.guildId } });
    if (count >= input.config.maxRules) {
      throw new AutoResponseValidationError(
        `自動応答ルールは最大${input.config.maxRules}件までです`,
      );
    }

    const created = await tx.autoResponse.create({
      data: {
        guildId: input.guildId,
        triggerType: 'message',
        ...normalized,
        responseCount: 0,
        failureCount: 0,
        lastTriggeredAt: null,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'auto_response.create',
        targetType: 'auto_response_rule',
        targetId: created.id,
        changes: { after: toSafeAuditRule(created) },
        metadata: {
          ruleId: created.id,
          operationSource: input.source,
          matchMode: created.matchMode,
          responseType: created.responseType,
        },
      },
    });
    return created;
  });
}

export async function getAutoResponseRule(
  prisma: AutoResponsePrismaClient,
  guildId: string,
  ruleId: string,
): Promise<AutoResponseRuleRecord | null> {
  assertDiscordId(guildId, 'Guild ID');
  assertRuleId(ruleId);
  return prisma.autoResponse.findFirst({ where: { id: ruleId, guildId } });
}

export async function listAutoResponseRules(
  prisma: AutoResponsePrismaClient,
  input: ListAutoResponseRulesInput,
): Promise<ListAutoResponseRulesResult> {
  assertDiscordId(input.guildId, 'Guild ID');
  const requestedPage = positiveInteger(input.page, 1);
  const pageSize = Math.min(positiveInteger(input.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const where = buildRuleWhere(input);
  const total = await prisma.autoResponse.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const items = await prisma.autoResponse.findMany({
    where,
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function listEnabledAutoResponseRules(
  prisma: AutoResponsePrismaClient,
  guildId: string,
  limit: number,
): Promise<AutoResponseRuleRecord[]> {
  assertDiscordId(guildId, 'Guild ID');
  return prisma.autoResponse.findMany({
    where: { guildId, enabled: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function updateAutoResponseRule(
  prisma: AutoResponsePrismaClient,
  input: UpdateAutoResponseRuleInput,
): Promise<AutoResponseRuleRecord | null> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertDiscordId(input.actorId, '操作ユーザーID');
  assertRuleId(input.ruleId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
    const current = await tx.autoResponse.findFirst({
      where: { id: input.ruleId, guildId: input.guildId },
    });
    if (!current) return null;

    const normalized = normalizeAutoResponseRuleInput(
      {
        name: input.patch.name ?? current.name,
        triggerValue: input.patch.triggerValue ?? current.triggerValue,
        matchMode: input.patch.matchMode ?? current.matchMode,
        responseType: input.patch.responseType ?? current.responseType,
        responseContent: input.patch.responseContent ?? current.responseContent,
        channelIds: input.patch.channelIds ?? current.channelIds,
        roleIds: input.patch.roleIds ?? current.roleIds,
        cooldownSeconds: input.patch.cooldownSeconds ?? current.cooldownSeconds,
        priority: input.patch.priority ?? current.priority,
        caseSensitive: input.patch.caseSensitive ?? current.caseSensitive,
        enabled: input.patch.enabled ?? current.enabled,
      },
      input.config,
    );
    const updated = await tx.autoResponse.update({
      where: { id: current.id },
      data: { ...normalized, updatedBy: input.actorId },
    });
    const event =
      current.enabled !== updated.enabled
        ? updated.enabled
          ? 'auto_response.enable'
          : 'auto_response.disable'
        : 'auto_response.update';
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event,
        targetType: 'auto_response_rule',
        targetId: current.id,
        changes: {
          before: toSafeAuditRule(current),
          after: toSafeAuditRule(updated),
        },
        metadata: {
          ruleId: current.id,
          operationSource: input.source,
          matchMode: updated.matchMode,
          responseType: updated.responseType,
        },
      },
    });
    return updated;
  });
}

export async function deleteAutoResponseRule(
  prisma: AutoResponsePrismaClient,
  input: { guildId: string; ruleId: string; actorId: string; source: AutoResponseOperationSource },
): Promise<AutoResponseRuleRecord | null> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertDiscordId(input.actorId, '操作ユーザーID');
  assertRuleId(input.ruleId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
    const current = await tx.autoResponse.findFirst({
      where: { id: input.ruleId, guildId: input.guildId },
    });
    if (!current) return null;
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'auto_response.delete',
        targetType: 'auto_response_rule',
        targetId: current.id,
        changes: { before: toSafeAuditRule(current) },
        metadata: { ruleId: current.id, operationSource: input.source },
      },
    });
    await tx.autoResponse.delete({ where: { id: current.id } });
    return current;
  });
}

export async function claimAutoResponseRule(
  prisma: AutoResponsePrismaClient,
  input: {
    guildId: string;
    ruleId: string;
    guildCooldownSeconds: number;
    now?: Date;
  },
): Promise<AutoResponseClaimResult> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertRuleId(input.ruleId);
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
    const rule = await tx.autoResponse.findFirst({
      where: { id: input.ruleId, guildId: input.guildId, enabled: true },
    });
    if (!rule) return 'unavailable';

    if (input.guildCooldownSeconds > 0) {
      const latestClaimedRule = await tx.autoResponse.findFirst({
        where: { guildId: input.guildId, lastTriggeredAt: { not: null } },
        orderBy: { lastTriggeredAt: 'desc' },
      });
      if (
        latestClaimedRule?.lastTriggeredAt &&
        now.getTime() - latestClaimedRule.lastTriggeredAt.getTime() <
          input.guildCooldownSeconds * 1000
      ) {
        return 'guild_cooldown';
      }
    }

    if (
      rule.lastTriggeredAt &&
      now.getTime() - rule.lastTriggeredAt.getTime() < rule.cooldownSeconds * 1000
    ) {
      return 'rule_cooldown';
    }

    await tx.autoResponse.update({
      where: { id: rule.id },
      data: { lastTriggeredAt: now },
    });
    return 'claimed';
  });
}

export async function recordAutoResponseExecution(
  prisma: AutoResponsePrismaClient,
  input: RecordAutoResponseExecutionInput,
): Promise<void> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertRuleId(input.ruleId);
  const durationMs = Math.max(0, Math.min(Math.floor(input.durationMs), 60_000));

  await prisma.$transaction(async (tx) => {
    await tx.autoResponseExecutionEvent.create({
      data: {
        guildId: input.guildId,
        ruleId: input.ruleId,
        status: input.status,
        durationMs,
        errorName: normalizeErrorName(input.errorName),
      },
    });
    if (input.status === 'success') {
      await tx.autoResponse.update({
        where: { id: input.ruleId },
        data: { responseCount: { increment: 1 } },
      });
    } else if (input.status === 'failure') {
      await tx.autoResponse.update({
        where: { id: input.ruleId },
        data: { failureCount: { increment: 1 } },
      });
    }
  });
}

export async function getAutoResponseStats(
  prisma: AutoResponsePrismaClient,
  guildId: string,
): Promise<AutoResponseStats> {
  assertDiscordId(guildId, 'Guild ID');
  const [successCount, failureCount, skippedCount, average] = await Promise.all([
    prisma.autoResponseExecutionEvent.count({ where: { guildId, status: 'success' } }),
    prisma.autoResponseExecutionEvent.count({ where: { guildId, status: 'failure' } }),
    prisma.autoResponseExecutionEvent.count({ where: { guildId, status: 'skipped' } }),
    prisma.autoResponseExecutionEvent.aggregate({
      where: { guildId },
      _avg: { durationMs: true },
    }),
  ]);
  return {
    successCount,
    failureCount,
    skippedCount,
    averageDurationMs: Math.round(average._avg.durationMs ?? 0),
  };
}

export async function pruneAutoResponseExecutionEvents(
  prisma: AutoResponsePrismaClient,
  retentionDays = AUTO_RESPONSE_EXECUTION_RETENTION_DAYS,
  now = new Date(),
): Promise<number> {
  const normalizedRetentionDays = Math.min(Math.max(Math.floor(retentionDays), 1), 3650);
  const before = new Date(now.getTime() - normalizedRetentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.autoResponseExecutionEvent.deleteMany({
    where: { executedAt: { lt: before } },
  });
  return result.count;
}

function buildRuleWhere(input: ListAutoResponseRulesInput): Record<string, unknown> {
  const where: Record<string, unknown> = { guildId: input.guildId };
  if (input.matchMode) where.matchMode = input.matchMode;
  if (input.responseType) where.responseType = input.responseType;
  if (typeof input.enabled === 'boolean') where.enabled = input.enabled;
  const search = input.search?.trim().slice(0, MAX_SEARCH_LENGTH);
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { triggerValue: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toSafeAuditRule(rule: AutoResponseRuleRecord): Record<string, unknown> {
  return {
    name: rule.name,
    matchMode: rule.matchMode,
    responseType: rule.responseType,
    enabled: rule.enabled,
    priority: rule.priority,
    caseSensitive: rule.caseSensitive,
    cooldownSeconds: rule.cooldownSeconds,
    channelScopeCount: rule.channelIds.length,
    roleScopeCount: rule.roleIds.length,
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

function normalizeErrorName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 100) : null;
}
