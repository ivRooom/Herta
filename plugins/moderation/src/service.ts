import { ModerationValidationError } from './config.js';

export type ModerationAction = 'warn' | 'timeout' | 'kick' | 'ban';
export type ModerationCaseAction = ModerationAction | 'flag';
export type ModerationCaseStatus = 'active' | 'completed' | 'revoked' | 'failed';
export type ModerationOperationSource = 'discord' | 'dashboard' | 'automatic';

export interface ModerationCaseRecord {
  id: string;
  guildId: string;
  caseNumber: number;
  action: ModerationCaseAction;
  targetUserId: string;
  moderatorUserId: string;
  reason: string | null;
  status: ModerationCaseStatus;
  durationSeconds: number | null;
  expiresAt: Date | null;
  discordActionId: string | null;
  source: ModerationOperationSource;
  originDetectionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AuditLogDelegate {
  create(args: Record<string, unknown>): Promise<unknown>;
}

export interface ModerationTransactionClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  auditLog: AuditLogDelegate;
}

export interface ModerationPrismaClient extends ModerationTransactionClient {
  $transaction<T>(callback: (tx: ModerationTransactionClient) => Promise<T>): Promise<T>;
}

export interface CreateModerationCaseInput {
  guildId: string;
  action: ModerationCaseAction;
  targetUserId: string;
  moderatorUserId: string;
  reason: string | null;
  status?: ModerationCaseStatus;
  durationSeconds?: number | null;
  expiresAt?: Date | null;
  discordActionId?: string | null;
  source: ModerationOperationSource;
  originDetectionId?: string | null;
}

export interface ListModerationCasesInput {
  guildId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  action?: ModerationCaseAction;
  status?: ModerationCaseStatus;
  targetUserId?: string;
  from?: Date | null;
  toExclusive?: Date | null;
}

export interface ListModerationCasesResult {
  items: ModerationCaseRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UpdateModerationCaseInput {
  guildId: string;
  caseNumber: number;
  actorId: string;
  source: ModerationOperationSource;
  reason?: string | null;
  status?: ModerationCaseStatus;
}

interface ModerationCaseRow {
  id: string;
  guild_id: string;
  case_number: number;
  action: string;
  target_user_id: string;
  moderator_user_id: string;
  reason: string | null;
  status: string;
  duration_seconds: number | null;
  expires_at: Date | null;
  discord_action_id: string | null;
  source: string;
  origin_detection_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;
const ALLOWED_ACTIONS = new Set<ModerationCaseAction>([
  'warn',
  'timeout',
  'kick',
  'ban',
  'flag',
]);
const ALLOWED_STATUSES = new Set<ModerationCaseStatus>([
  'active',
  'completed',
  'revoked',
  'failed',
]);
const ALLOWED_SOURCES = new Set<ModerationOperationSource>([
  'discord',
  'dashboard',
  'automatic',
]);

export async function createModerationCase(
  prisma: ModerationPrismaClient,
  input: CreateModerationCaseInput,
): Promise<ModerationCaseRecord> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertDiscordId(input.targetUserId, '対象ユーザーID');
  assertDiscordId(input.moderatorUserId, '実行者ID');
  const action = normalizeAction(input.action);
  const status = normalizeStatus(input.status ?? defaultStatusForAction(action));
  const durationSeconds = normalizeNullablePositiveInteger(input.durationSeconds, '期間');
  const expiresAt = normalizeDate(input.expiresAt, '有効期限');
  const source = normalizeSource(input.source);
  const originDetectionId = normalizeNullableUuid(input.originDetectionId, '元検知ID');

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
    const rows = await tx.$queryRawUnsafe<ModerationCaseRow[]>(
      `INSERT INTO moderation_cases (
         guild_id,
         case_number,
         action,
         target_user_id,
         moderator_user_id,
         reason,
         status,
         duration_seconds,
         expires_at,
         discord_action_id,
         source,
         origin_detection_id
       )
       SELECT
         $1,
         COALESCE(MAX(case_number), 0) + 1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11::uuid
       FROM moderation_cases
       WHERE guild_id = $1
       RETURNING *`,
      input.guildId,
      action,
      input.targetUserId,
      input.moderatorUserId,
      input.reason,
      status,
      durationSeconds,
      expiresAt,
      input.discordActionId ?? null,
      source,
      originDetectionId,
    );
    const created = rows[0];
    if (!created) throw new Error('Moderation Caseの作成に失敗しました');

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.moderatorUserId,
        event: `moderation.${action}`,
        targetType: 'moderation_case',
        targetId: created.id,
        changes: { after: { status, durationSeconds } },
        metadata: {
          caseNumber: created.case_number,
          action,
          targetUserId: input.targetUserId,
          operationSource: source,
          originDetectionId,
        },
        severity: action === 'ban' ? 'warning' : 'info',
      },
    });

    return toRecord(created);
  });
}

export async function getModerationCase(
  prisma: ModerationPrismaClient,
  guildId: string,
  caseNumber: number,
): Promise<ModerationCaseRecord | null> {
  assertDiscordId(guildId, 'Guild ID');
  assertCaseNumber(caseNumber);
  const rows = await prisma.$queryRawUnsafe<ModerationCaseRow[]>(
    `SELECT *
     FROM moderation_cases
     WHERE guild_id = $1 AND case_number = $2
     LIMIT 1`,
    guildId,
    caseNumber,
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listModerationCases(
  prisma: ModerationPrismaClient,
  input: ListModerationCasesInput,
): Promise<ListModerationCasesResult> {
  assertDiscordId(input.guildId, 'Guild ID');
  const page = positiveInteger(input.page, 1);
  const pageSize = Math.min(positiveInteger(input.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const values: unknown[] = [input.guildId];
  const filters = ['guild_id = $1'];
  const addFilter = (sql: string, value: unknown) => {
    values.push(value);
    filters.push(sql.replace('?', `$${values.length}`));
  };

  if (input.action) addFilter('action = ?', normalizeAction(input.action));
  if (input.status) addFilter('status = ?', normalizeStatus(input.status));
  if (input.targetUserId) {
    assertDiscordId(input.targetUserId, '対象ユーザーID');
    addFilter('target_user_id = ?', input.targetUserId);
  }
  if (input.from) addFilter('created_at >= ?', normalizeDate(input.from, '開始日時'));
  if (input.toExclusive) addFilter('created_at < ?', normalizeDate(input.toExclusive, '終了日時'));
  const search = input.search?.trim().slice(0, MAX_SEARCH_LENGTH);
  if (search) {
    values.push(`%${escapeLike(search)}%`);
    const placeholder = `$${values.length}`;
    filters.push(
      `(CAST(case_number AS TEXT) = ${placeholder.replace('%', '')} OR target_user_id ILIKE ${placeholder} ESCAPE '\\' OR moderator_user_id ILIKE ${placeholder} ESCAPE '\\' OR reason ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  const where = filters.join(' AND ');
  const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count FROM moderation_cases WHERE ${where}`,
    ...values,
  );
  const total = Number(countRows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const resolvedPage = Math.min(page, totalPages);
  const queryValues = [...values, pageSize, (resolvedPage - 1) * pageSize];
  const rows = await prisma.$queryRawUnsafe<ModerationCaseRow[]>(
    `SELECT *
     FROM moderation_cases
     WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${queryValues.length - 1}
     OFFSET $${queryValues.length}`,
    ...queryValues,
  );

  return {
    items: rows.map(toRecord),
    total,
    page: resolvedPage,
    pageSize,
    totalPages,
  };
}

export async function updateModerationCase(
  prisma: ModerationPrismaClient,
  input: UpdateModerationCaseInput,
): Promise<ModerationCaseRecord | null> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertDiscordId(input.actorId, '実行者ID');
  assertCaseNumber(input.caseNumber);
  if (input.reason === undefined && input.status === undefined) {
    throw new ModerationValidationError('更新内容を指定してください');
  }
  const status = input.status === undefined ? undefined : normalizeStatus(input.status);
  const source = normalizeSource(input.source);

  return prisma.$transaction(async (tx) => {
    const currentRows = await tx.$queryRawUnsafe<ModerationCaseRow[]>(
      `SELECT * FROM moderation_cases
       WHERE guild_id = $1 AND case_number = $2
       FOR UPDATE`,
      input.guildId,
      input.caseNumber,
    );
    const current = currentRows[0];
    if (!current) return null;

    const values: unknown[] = [];
    const sets: string[] = [];
    if (input.reason !== undefined) {
      values.push(input.reason);
      sets.push(`reason = $${values.length}`);
    }
    if (status !== undefined) {
      values.push(status);
      sets.push(`status = $${values.length}`);
    }
    sets.push('updated_at = NOW()');
    values.push(input.guildId, input.caseNumber);
    const rows = await tx.$queryRawUnsafe<ModerationCaseRow[]>(
      `UPDATE moderation_cases
       SET ${sets.join(', ')}
       WHERE guild_id = $${values.length - 1} AND case_number = $${values.length}
       RETURNING *`,
      ...values,
    );
    const updated = rows[0];
    if (!updated) return null;

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'moderation.case.update',
        targetType: 'moderation_case',
        targetId: current.id,
        changes: {
          before: { status: current.status },
          after: { status: updated.status },
          reasonChanged: input.reason !== undefined,
        },
        metadata: {
          caseNumber: current.case_number,
          action: current.action,
          targetUserId: current.target_user_id,
          operationSource: source,
        },
      },
    });
    return toRecord(updated);
  });
}

export async function pruneModerationCases(
  prisma: ModerationPrismaClient,
  guildId: string,
  retentionDays: number,
): Promise<number> {
  assertDiscordId(guildId, 'Guild ID');
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650) {
    throw new ModerationValidationError('保持日数は30〜3650日で指定してください');
  }
  return prisma.$executeRawUnsafe(
    `DELETE FROM moderation_cases
     WHERE guild_id = $1
       AND created_at < NOW() - ($2::text || ' days')::interval`,
    guildId,
    retentionDays,
  );
}

function toRecord(row: ModerationCaseRow): ModerationCaseRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    caseNumber: row.case_number,
    action: normalizeAction(row.action),
    targetUserId: row.target_user_id,
    moderatorUserId: row.moderator_user_id,
    reason: row.reason,
    status: normalizeStatus(row.status),
    durationSeconds: row.duration_seconds,
    expiresAt: row.expires_at,
    discordActionId: row.discord_action_id,
    source: normalizeSource(row.source),
    originDetectionId: row.origin_detection_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultStatusForAction(action: ModerationCaseAction): ModerationCaseStatus {
  return action === 'kick' ? 'completed' : 'active';
}

function normalizeAction(value: unknown): ModerationCaseAction {
  if (typeof value !== 'string' || !ALLOWED_ACTIONS.has(value as ModerationCaseAction)) {
    throw new ModerationValidationError('モデレーション種別が不正です');
  }
  return value as ModerationCaseAction;
}

function normalizeStatus(value: unknown): ModerationCaseStatus {
  if (typeof value !== 'string' || !ALLOWED_STATUSES.has(value as ModerationCaseStatus)) {
    throw new ModerationValidationError('ケース状態が不正です');
  }
  return value as ModerationCaseStatus;
}

function normalizeSource(value: unknown): ModerationOperationSource {
  if (typeof value !== 'string' || !ALLOWED_SOURCES.has(value as ModerationOperationSource)) {
    throw new ModerationValidationError('操作元が不正です');
  }
  return value as ModerationOperationSource;
}

function normalizeNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ModerationValidationError(`${label}が不正です`);
  }
  return value;
}

function normalizeDate(value: unknown, label: string): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ModerationValidationError(`${label}が不正です`);
  }
  return value;
}

function normalizeNullableUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ModerationValidationError(`${label}が不正です`);
  }
  return value;
}

function assertDiscordId(value: string, label: string): void {
  if (!/^\d+$/.test(value)) throw new ModerationValidationError(`${label}が不正です`);
}

function assertCaseNumber(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ModerationValidationError('ケース番号は1以上の整数で指定してください');
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
