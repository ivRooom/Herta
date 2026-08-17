import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

export type DiscordRoleOperationKind = 'create' | 'delete';
export type DiscordRoleOperationStatus =
  'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
export type DiscordRoleOperationSource = 'studio' | 'temporary-expiry' | 'rule-engine';

export interface DiscordRoleOperationRecord {
  id: string;
  guildId: string;
  operation: DiscordRoleOperationKind;
  status: DiscordRoleOperationStatus;
  source: DiscordRoleOperationSource;
  discordRoleId: string | null;
  roleName: string | null;
  roleColor: number | null;
  scheduledFor: Date;
  expiresAfterSeconds: number | null;
  nextAttemptAt: Date | null;
  attemptCount: number;
  claimedAt: Date | null;
  completedAt: Date | null;
  lastErrorName: string | null;
  parentOperationId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueDiscordRoleCreateInput {
  guildId: string;
  roleName: string;
  roleColor: number;
  scheduledFor: Date;
  expiresAfterSeconds: number | null;
  createdBy: string;
  source?: Extract<DiscordRoleOperationSource, 'studio' | 'rule-engine'>;
  operationId?: string;
  idempotencyFingerprint?: string;
}

export interface EnqueueDiscordRoleDeleteInput {
  guildId: string;
  discordRoleId: string;
  roleName?: string | null;
  scheduledFor: Date;
  createdBy: string;
  source: Extract<DiscordRoleOperationSource, 'studio' | 'temporary-expiry' | 'rule-engine'>;
  parentOperationId?: string | null;
}

type RoleOperationDb = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const IDEMPOTENCY_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const ROLE_NAME_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_ROLE_NAME_LENGTH = 100;
const MIN_EXPIRY_SECONDS = 60;
const MAX_EXPIRY_SECONDS = 31_536_000;

export class DiscordRoleOperationIdempotencyConflictError extends Error {
  constructor() {
    super('Discord role operation idempotency key is already used by another request');
    this.name = 'DiscordRoleOperationIdempotencyConflictError';
  }
}

export async function enqueueDiscordRoleCreateOperation(
  db: RoleOperationDb,
  input: EnqueueDiscordRoleCreateInput,
): Promise<DiscordRoleOperationRecord> {
  assertDiscordId(input.guildId, 'guildId');
  assertDiscordId(input.createdBy, 'createdBy');
  const hasOperationId = input.operationId !== undefined;
  const hasIdempotencyFingerprint = input.idempotencyFingerprint !== undefined;
  if (hasOperationId !== hasIdempotencyFingerprint) {
    throw new RangeError('operationId and idempotencyFingerprint must be provided together');
  }
  if (input.operationId) assertUuid(input.operationId, 'operationId');
  if (
    input.idempotencyFingerprint &&
    !IDEMPOTENCY_FINGERPRINT_PATTERN.test(input.idempotencyFingerprint)
  ) {
    throw new RangeError('idempotencyFingerprint must be a lowercase SHA-256 hex digest');
  }
  const roleName = input.roleName.trim();
  if (
    !roleName ||
    roleName.length > MAX_ROLE_NAME_LENGTH ||
    ROLE_NAME_CONTROL_CHARACTER_PATTERN.test(roleName)
  ) {
    throw new RangeError('roleName must be between 1 and 100 printable characters');
  }
  if (!Number.isInteger(input.roleColor) || input.roleColor < 0 || input.roleColor > 0xffffff) {
    throw new RangeError('roleColor must be an integer between 0 and 0xFFFFFF');
  }
  assertValidDate(input.scheduledFor, 'scheduledFor');
  if (
    input.expiresAfterSeconds !== null &&
    (!Number.isInteger(input.expiresAfterSeconds) ||
      input.expiresAfterSeconds < MIN_EXPIRY_SECONDS ||
      input.expiresAfterSeconds > MAX_EXPIRY_SECONDS)
  ) {
    throw new RangeError('expiresAfterSeconds must be between 60 and 31536000');
  }

  const id = input.operationId ?? randomUUID();
  const idempotencyFingerprint = input.idempotencyFingerprint ?? null;
  const rows = await db.$queryRaw<DiscordRoleOperationRecord[]>`
    INSERT INTO "discord_role_operations" (
      "id", "guild_id", "operation", "status", "source", "role_name", "role_color",
      "scheduled_for", "expires_after_seconds", "created_by", "idempotency_fingerprint"
    ) VALUES (
      ${id}::uuid,
      ${input.guildId},
      'create',
      'pending',
      ${input.source ?? 'studio'},
      ${roleName},
      ${input.roleColor},
      ${input.scheduledFor},
      ${input.expiresAfterSeconds},
      ${input.createdBy},
      ${idempotencyFingerprint}
    )
    ON CONFLICT ("id") DO NOTHING
    RETURNING ${operationProjection()}
  `;
  if (rows[0]) return rows[0];

  const existingRows = await db.$queryRaw<DiscordRoleOperationRecord[]>`
    SELECT ${operationProjection()}
    FROM "discord_role_operations"
    WHERE "id" = ${id}::uuid
      AND "guild_id" = ${input.guildId}
      AND "created_by" = ${input.createdBy}
      AND "operation" = 'create'
      AND "idempotency_fingerprint" = ${idempotencyFingerprint}
    LIMIT 1
  `;
  if (existingRows[0]) return existingRows[0];
  throw new DiscordRoleOperationIdempotencyConflictError();
}

export async function enqueueDiscordRoleDeleteOperation(
  db: RoleOperationDb,
  input: EnqueueDiscordRoleDeleteInput,
): Promise<DiscordRoleOperationRecord> {
  assertDiscordId(input.guildId, 'guildId');
  assertDiscordId(input.discordRoleId, 'discordRoleId');
  assertDiscordId(input.createdBy, 'createdBy');
  assertValidDate(input.scheduledFor, 'scheduledFor');
  const roleName = input.roleName?.trim().slice(0, MAX_ROLE_NAME_LENGTH) || null;
  const id = randomUUID();
  const parentOperationId = input.parentOperationId ?? null;

  const rows = await db.$queryRaw<DiscordRoleOperationRecord[]>`
    INSERT INTO "discord_role_operations" (
      "id", "guild_id", "operation", "status", "source", "discord_role_id", "role_name",
      "scheduled_for", "parent_operation_id", "created_by"
    ) VALUES (
      ${id}::uuid,
      ${input.guildId},
      'delete',
      'pending',
      ${input.source},
      ${input.discordRoleId},
      ${roleName},
      ${input.scheduledFor},
      ${parentOperationId}::uuid,
      ${input.createdBy}
    )
    ON CONFLICT ("guild_id", "discord_role_id")
      WHERE "operation" = 'delete' AND "status" IN ('pending', 'processing')
    DO UPDATE SET
      "scheduled_for" = LEAST("discord_role_operations"."scheduled_for", EXCLUDED."scheduled_for"),
      "next_attempt_at" = CASE
        WHEN "discord_role_operations"."status" = 'pending' THEN NULL
        ELSE "discord_role_operations"."next_attempt_at"
      END,
      "source" = CASE
        WHEN "discord_role_operations"."status" = 'pending' AND EXCLUDED."source" = 'studio'
          THEN 'studio'
        ELSE "discord_role_operations"."source"
      END,
      "created_by" = CASE
        WHEN "discord_role_operations"."status" = 'pending' AND EXCLUDED."source" = 'studio'
          THEN EXCLUDED."created_by"
        ELSE "discord_role_operations"."created_by"
      END,
      "updated_at" = CURRENT_TIMESTAMP
    RETURNING ${operationProjection()}
  `;
  return requireOperation(rows[0]);
}

export async function listRecentDiscordRoleOperations(
  db: RoleOperationDb,
  guildId: string,
  limit = 20,
): Promise<DiscordRoleOperationRecord[]> {
  assertDiscordId(guildId, 'guildId');
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return db.$queryRaw<DiscordRoleOperationRecord[]>`
    SELECT ${operationProjection()}
    FROM "discord_role_operations"
    WHERE "guild_id" = ${guildId}
    ORDER BY "created_at" DESC
    LIMIT ${safeLimit}
  `;
}

export async function countPendingDiscordRoleCreates(
  db: RoleOperationDb,
  guildId: string,
): Promise<number> {
  assertDiscordId(guildId, 'guildId');
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "discord_role_operations"
    WHERE "guild_id" = ${guildId}
      AND "operation" = 'create'
      AND "status" IN ('pending', 'processing')
  `;
  return Number(rows[0]?.count ?? 0n);
}

export async function listDueDiscordRoleOperations(
  db: RoleOperationDb,
  now: Date,
  limit = 25,
): Promise<DiscordRoleOperationRecord[]> {
  assertValidDate(now, 'now');
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return db.$queryRaw<DiscordRoleOperationRecord[]>`
    SELECT ${operationProjection()}
    FROM "discord_role_operations"
    WHERE "status" = 'pending'
      AND COALESCE("next_attempt_at", "scheduled_for") <= ${now}
    ORDER BY COALESCE("next_attempt_at", "scheduled_for") ASC, "created_at" ASC
    LIMIT ${safeLimit}
  `;
}

export async function claimDiscordRoleOperation(
  db: RoleOperationDb,
  id: string,
  now: Date,
): Promise<DiscordRoleOperationRecord | null> {
  assertUuid(id, 'id');
  assertValidDate(now, 'now');
  const rows = await db.$queryRaw<DiscordRoleOperationRecord[]>`
    UPDATE "discord_role_operations"
    SET
      "status" = 'processing',
      "attempt_count" = "attempt_count" + 1,
      "claimed_at" = ${now},
      "next_attempt_at" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}::uuid AND "status" = 'pending'
    RETURNING ${operationProjection()}
  `;
  return rows[0] ?? null;
}

export async function markDiscordRoleOperationSucceeded(
  db: RoleOperationDb,
  id: string,
  now: Date,
  discordRoleId?: string | null,
): Promise<void> {
  assertUuid(id, 'id');
  assertValidDate(now, 'now');
  if (discordRoleId) assertDiscordId(discordRoleId, 'discordRoleId');
  await db.$executeRaw`
    UPDATE "discord_role_operations"
    SET
      "status" = 'succeeded',
      "discord_role_id" = COALESCE(${discordRoleId ?? null}, "discord_role_id"),
      "completed_at" = ${now},
      "claimed_at" = NULL,
      "last_error_name" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}::uuid AND "status" = 'processing'
  `;
}

export async function markDiscordRoleOperationFailed(
  db: RoleOperationDb,
  id: string,
  now: Date,
  errorName: string,
  discordRoleId?: string | null,
): Promise<void> {
  assertUuid(id, 'id');
  assertValidDate(now, 'now');
  if (discordRoleId) assertDiscordId(discordRoleId, 'discordRoleId');
  const normalizedErrorName = normalizeErrorName(errorName);
  await db.$executeRaw`
    UPDATE "discord_role_operations"
    SET
      "status" = 'failed',
      "discord_role_id" = COALESCE(${discordRoleId ?? null}, "discord_role_id"),
      "completed_at" = ${now},
      "claimed_at" = NULL,
      "next_attempt_at" = NULL,
      "last_error_name" = ${normalizedErrorName},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}::uuid AND "status" = 'processing'
  `;
}

export async function rescheduleDiscordRoleDeleteOperation(
  db: RoleOperationDb,
  id: string,
  nextAttemptAt: Date,
  errorName: string,
): Promise<void> {
  assertUuid(id, 'id');
  assertValidDate(nextAttemptAt, 'nextAttemptAt');
  const normalizedErrorName = normalizeErrorName(errorName);
  await db.$executeRaw`
    UPDATE "discord_role_operations"
    SET
      "status" = 'pending',
      "claimed_at" = NULL,
      "next_attempt_at" = ${nextAttemptAt},
      "last_error_name" = ${normalizedErrorName},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}::uuid AND "operation" = 'delete' AND "status" = 'processing'
  `;
}

export async function recoverStaleDiscordRoleOperations(
  db: RoleOperationDb,
  staleBefore: Date,
  now: Date,
): Promise<{ createFailed: number; deleteRequeued: number }> {
  assertValidDate(staleBefore, 'staleBefore');
  assertValidDate(now, 'now');

  const createFailed = await db.$executeRaw`
    UPDATE "discord_role_operations"
    SET
      "status" = 'failed',
      "completed_at" = ${now},
      "claimed_at" = NULL,
      "last_error_name" = 'DiscordRoleCreateOutcomeUnknown',
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "operation" = 'create'
      AND "status" = 'processing'
      AND "claimed_at" < ${staleBefore}
  `;
  const deleteRequeued = await db.$executeRaw`
    UPDATE "discord_role_operations"
    SET
      "status" = 'pending',
      "claimed_at" = NULL,
      "next_attempt_at" = ${now},
      "last_error_name" = 'DiscordRoleDeleteInterrupted',
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "operation" = 'delete'
      AND "status" = 'processing'
      AND "claimed_at" < ${staleBefore}
  `;
  return { createFailed, deleteRequeued };
}

export async function removeStudioRolePolicyForDeletedDiscordRole(
  db: RoleOperationDb,
  guildId: string,
  discordRoleId: string,
): Promise<void> {
  assertDiscordId(guildId, 'guildId');
  assertDiscordId(discordRoleId, 'discordRoleId');
  await db.$executeRaw`
    UPDATE "guild_settings"
    SET "settings_json" = jsonb_set(
      "settings_json"::jsonb,
      '{studioAccess,rolePolicies}',
      COALESCE("settings_json"::jsonb #> '{studioAccess,rolePolicies}', '{}'::jsonb) - ${discordRoleId},
      true
    )
    WHERE "guild_id" = ${guildId}
      AND "settings_json"::jsonb #> '{studioAccess,rolePolicies}' IS NOT NULL
  `;
}

function operationProjection(): Prisma.Sql {
  return Prisma.raw(`
    "id",
    "guild_id" AS "guildId",
    "operation",
    "status",
    "source",
    "discord_role_id" AS "discordRoleId",
    "role_name" AS "roleName",
    "role_color" AS "roleColor",
    "scheduled_for" AS "scheduledFor",
    "expires_after_seconds" AS "expiresAfterSeconds",
    "next_attempt_at" AS "nextAttemptAt",
    "attempt_count" AS "attemptCount",
    "claimed_at" AS "claimedAt",
    "completed_at" AS "completedAt",
    "last_error_name" AS "lastErrorName",
    "parent_operation_id" AS "parentOperationId",
    "created_by" AS "createdBy",
    "created_at" AS "createdAt",
    "updated_at" AS "updatedAt"
  `);
}

function requireOperation(
  operation: DiscordRoleOperationRecord | undefined,
): DiscordRoleOperationRecord {
  if (!operation) throw new Error('Discord role operation was not persisted');
  return operation;
}

function assertDiscordId(value: string, field: string): void {
  if (!DISCORD_ID_PATTERN.test(value)) throw new RangeError(`${field} must be a Discord snowflake`);
}

function assertUuid(value: string, field: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new RangeError(`${field} must be a UUID`);
  }
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${field} must be a valid Date`);
  }
}

function normalizeErrorName(value: string): string {
  const normalized = value.trim().slice(0, 120);
  return normalized || 'UnknownError';
}
