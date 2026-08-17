import { Prisma, type PrismaClient } from '@prisma/client';
import type { EvaluationResult, TriggerEvent } from '@herta/shared';

export interface StoredRuleRuntimeRecord {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  schemaVersion: number;
  trigger: Prisma.JsonValue;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  cooldownMs: number;
  maxExecutions: number | null;
  executionCount: number;
  createdBy: string;
}

export type RuleExecutionReservationReason =
  | 'rule-disabled'
  | 'duplicate-event'
  | 'max-executions'
  | 'cooldown';

export type RuleExecutionReservation =
  | { allowed: true; executionCount: number }
  | { allowed: false; reason: RuleExecutionReservationReason };

export interface RecentRuleExecutionLogRecord {
  id: string;
  ruleId: string;
  ruleName: string;
  triggerType: string;
  triggerExecutionId: string | null;
  conditionsMet: boolean;
  actionsResult: Prisma.JsonValue | null;
  error: string | null;
  durationMs: number | null;
  executedAt: Date;
}

interface RuleRuntimeRow {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  schemaVersion: number;
  trigger: Prisma.JsonValue;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  cooldownMs: number;
  maxExecutions: number | null;
  executionCount: number;
  createdBy: string;
}

interface LockedRuleRow {
  enabled: boolean;
  cooldownMs: number;
  maxExecutions: number | null;
  executionCount: number;
}

interface RecentRuleExecutionLogRow {
  id: string;
  ruleId: string;
  ruleName: string;
  triggerType: string;
  triggerExecutionId: string | null;
  conditionsMet: boolean;
  actionsResult: Prisma.JsonValue | null;
  error: string | null;
  durationMs: number | null;
  executedAt: Date;
}

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_TRIGGER_TYPE_LENGTH = 96;
const MAX_TRIGGER_EXECUTION_ID_LENGTH = 160;
const MAX_LOG_ERROR_LENGTH = 500;
const MAX_RECENT_LOGS = 100;

export async function listEnabledRuleRuntimeRecords(
  prisma: PrismaClient,
  guildId: string,
  triggerType: string,
): Promise<StoredRuleRuntimeRecord[]> {
  assertDiscordId(guildId, 'guildId');
  const normalizedTriggerType = normalizeTriggerType(triggerType);
  const rows = await prisma.$queryRaw<RuleRuntimeRow[]>`
    SELECT
      "id",
      "guild_id" AS "guildId",
      "name",
      "description",
      "enabled",
      "priority",
      "schema_version" AS "schemaVersion",
      "trigger",
      "conditions",
      "actions",
      "cooldown_ms" AS "cooldownMs",
      "max_executions" AS "maxExecutions",
      "execution_count" AS "executionCount",
      "created_by" AS "createdBy"
    FROM "rules"
    WHERE "guild_id" = ${guildId}
      AND "enabled" = TRUE
      AND "trigger" ->> 'type' = ${normalizedTriggerType}
    ORDER BY "priority" DESC, "id" ASC
  `;
  return rows;
}

export async function listGuildIdsWithEnabledRuleTrigger(
  prisma: PrismaClient,
  triggerType: string,
): Promise<string[]> {
  const normalizedTriggerType = normalizeTriggerType(triggerType);
  const rows = await prisma.$queryRaw<Array<{ guildId: string }>>`
    SELECT DISTINCT "guild_id" AS "guildId"
    FROM "rules"
    WHERE "enabled" = TRUE
      AND "trigger" ->> 'type' = ${normalizedTriggerType}
    ORDER BY "guild_id" ASC
  `;
  return rows.map((row) => row.guildId).filter((guildId) => DISCORD_ID_PATTERN.test(guildId));
}

/**
 * Condition成立後、Action実行直前に呼び出すatomic claim。
 * Rule rowをlockし、placeholder logも同じtransactionで作成して、同一eventの再配送を遮断する。
 */
export async function reserveRuleRuntimeExecution(
  prisma: PrismaClient,
  input: {
    guildId: string;
    ruleId: string;
    triggerExecutionId: string;
    now: Date;
  },
): Promise<RuleExecutionReservation> {
  assertDiscordId(input.guildId, 'guildId');
  assertUuid(input.ruleId, 'ruleId');
  const triggerExecutionId = normalizeTriggerExecutionId(input.triggerExecutionId);
  assertValidDate(input.now, 'now');

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedRuleRow[]>`
      SELECT
        "enabled",
        "cooldown_ms" AS "cooldownMs",
        "max_executions" AS "maxExecutions",
        "execution_count" AS "executionCount"
      FROM "rules"
      WHERE "id" = ${input.ruleId}::uuid
        AND "guild_id" = ${input.guildId}
      FOR UPDATE
    `;
    const rule = rows[0];
    if (!rule?.enabled) return { allowed: false, reason: 'rule-disabled' };

    const duplicateRows = await tx.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "rule_execution_logs"
        WHERE "rule_id" = ${input.ruleId}::uuid
          AND "guild_id" = ${input.guildId}
          AND "trigger_event" ->> 'executionId' = ${triggerExecutionId}
      ) AS "present"
    `;
    if (duplicateRows[0]?.present) {
      return { allowed: false, reason: 'duplicate-event' };
    }

    if (rule.maxExecutions !== null && rule.executionCount >= rule.maxExecutions) {
      return { allowed: false, reason: 'max-executions' };
    }

    if (rule.cooldownMs > 0) {
      const lastExecutionRows = await tx.$queryRaw<Array<{ executedAt: Date }>>`
        SELECT "executed_at" AS "executedAt"
        FROM "rule_execution_logs"
        WHERE "rule_id" = ${input.ruleId}::uuid
          AND "guild_id" = ${input.guildId}
          AND "conditions_met" = TRUE
          AND "actions_result" ->> 'actionsExecuted' = 'true'
        ORDER BY "executed_at" DESC
        LIMIT 1
      `;
      const lastExecution = lastExecutionRows[0]?.executedAt;
      if (lastExecution && input.now.getTime() - lastExecution.getTime() < rule.cooldownMs) {
        return { allowed: false, reason: 'cooldown' };
      }
    }

    await tx.ruleExecutionLog.create({
      data: {
        ruleId: input.ruleId,
        guildId: input.guildId,
        triggerEvent: {
          executionId: triggerExecutionId,
          type: 'reservation',
          guildId: input.guildId,
          data: {},
          timestamp: input.now.toISOString(),
        },
        conditionsMet: true,
        actionsResult: {
          reservation: true,
          actionsExecuted: false,
          results: [],
        },
        durationMs: null,
        executedAt: input.now,
      },
    });

    const updated = await tx.$queryRaw<Array<{ executionCount: number }>>`
      UPDATE "rules"
      SET "execution_count" = "execution_count" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.ruleId}::uuid
        AND "guild_id" = ${input.guildId}
        AND "enabled" = TRUE
      RETURNING "execution_count" AS "executionCount"
    `;
    if (!updated[0]) return { allowed: false, reason: 'rule-disabled' };
    return { allowed: true, executionCount: updated[0].executionCount };
  });
}

export async function recordRuleRuntimeExecution(
  prisma: PrismaClient,
  input: {
    event: TriggerEvent;
    triggerExecutionId: string;
    result: EvaluationResult;
    executedAt?: Date;
  },
): Promise<void> {
  assertDiscordId(input.event.guildId, 'event.guildId');
  assertUuid(input.result.ruleId, 'result.ruleId');
  const triggerExecutionId = normalizeTriggerExecutionId(input.triggerExecutionId);
  const executedAt = input.executedAt ?? new Date();
  assertValidDate(executedAt, 'executedAt');

  const triggerEvent = {
    executionId: triggerExecutionId,
    type: input.event.type,
    guildId: input.event.guildId,
    data: input.event.data,
    timestamp: input.event.timestamp.toISOString(),
  };
  const actionsResult = {
    triggerMatched: input.result.triggerMatched,
    actionsExecuted: input.result.actionsExecuted,
    actionSkipReason: input.result.actionSkipReason ?? null,
    results: input.result.actionResults,
  };
  const triggerEventJson = JSON.stringify(triggerEvent);
  const actionsResultJson = JSON.stringify(actionsResult);
  const normalizedError = normalizeLogError(input.result.error);
  const durationMs = normalizeDuration(input.result.durationMs);

  const updated = await prisma.$executeRaw`
    WITH target AS (
      SELECT "id"
      FROM "rule_execution_logs"
      WHERE "rule_id" = ${input.result.ruleId}::uuid
        AND "guild_id" = ${input.event.guildId}
        AND "trigger_event" ->> 'executionId' = ${triggerExecutionId}
      ORDER BY "executed_at" DESC, "id" DESC
      LIMIT 1
    )
    UPDATE "rule_execution_logs"
    SET
      "trigger_event" = ${triggerEventJson}::jsonb,
      "conditions_met" = ${input.result.conditionsMet},
      "actions_result" = ${actionsResultJson}::jsonb,
      "error" = ${normalizedError},
      "duration_ms" = ${durationMs},
      "executed_at" = ${executedAt}
    WHERE "id" IN (SELECT "id" FROM target)
  `;
  if (updated > 0) return;

  await prisma.ruleExecutionLog.create({
    data: {
      ruleId: input.result.ruleId,
      guildId: input.event.guildId,
      triggerEvent: toJsonValue(triggerEvent),
      conditionsMet: input.result.conditionsMet,
      actionsResult: toJsonValue(actionsResult),
      error: normalizedError,
      durationMs,
      executedAt,
    },
  });
}

export async function recordInvalidStoredRuleExecution(
  prisma: PrismaClient,
  input: {
    guildId: string;
    ruleId: string;
    triggerType: string;
    triggerExecutionId: string;
    error: string;
    executedAt?: Date;
  },
): Promise<void> {
  assertDiscordId(input.guildId, 'guildId');
  assertUuid(input.ruleId, 'ruleId');
  const triggerType = normalizeTriggerType(input.triggerType);
  const triggerExecutionId = normalizeTriggerExecutionId(input.triggerExecutionId);
  const executedAt = input.executedAt ?? new Date();
  assertValidDate(executedAt, 'executedAt');

  await prisma.ruleExecutionLog.create({
    data: {
      ruleId: input.ruleId,
      guildId: input.guildId,
      triggerEvent: {
        executionId: triggerExecutionId,
        type: triggerType,
        guildId: input.guildId,
        data: {},
        timestamp: executedAt.toISOString(),
      },
      conditionsMet: false,
      actionsResult: { triggerMatched: false, actionsExecuted: false, results: [] },
      error: normalizeLogError(input.error),
      durationMs: 0,
      executedAt,
    },
  });
}

export async function listRecentRuleRuntimeExecutionLogs(
  prisma: PrismaClient,
  guildId: string,
  limit = 30,
): Promise<RecentRuleExecutionLogRecord[]> {
  assertDiscordId(guildId, 'guildId');
  const safeLimit = Math.max(1, Math.min(MAX_RECENT_LOGS, Math.trunc(limit)));
  return prisma.$queryRaw<RecentRuleExecutionLogRow[]>`
    SELECT
      l."id",
      l."rule_id" AS "ruleId",
      r."name" AS "ruleName",
      COALESCE(l."trigger_event" ->> 'type', 'unknown') AS "triggerType",
      l."trigger_event" ->> 'executionId' AS "triggerExecutionId",
      l."conditions_met" AS "conditionsMet",
      l."actions_result" AS "actionsResult",
      l."error",
      l."duration_ms" AS "durationMs",
      l."executed_at" AS "executedAt"
    FROM "rule_execution_logs" l
    INNER JOIN "rules" r
      ON r."id" = l."rule_id" AND r."guild_id" = l."guild_id"
    WHERE l."guild_id" = ${guildId}
    ORDER BY l."executed_at" DESC, l."id" DESC
    LIMIT ${safeLimit}
  `;
}

function normalizeTriggerType(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TRIGGER_TYPE_LENGTH) {
    throw new RangeError(`triggerType must be between 1 and ${MAX_TRIGGER_TYPE_LENGTH} characters`);
  }
  return normalized;
}

function normalizeTriggerExecutionId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TRIGGER_EXECUTION_ID_LENGTH) {
    throw new RangeError(
      `triggerExecutionId must be between 1 and ${MAX_TRIGGER_EXECUTION_ID_LENGTH} characters`,
    );
  }
  return normalized;
}

function normalizeLogError(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_LOG_ERROR_LENGTH) : null;
}

function normalizeDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(2_147_483_647, Math.trunc(value)));
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertDiscordId(value: string, field: string): void {
  if (!DISCORD_ID_PATTERN.test(value)) throw new RangeError(`${field} must be a Discord snowflake`);
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new RangeError(`${field} must be a UUID`);
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${field} must be a valid Date`);
  }
}
