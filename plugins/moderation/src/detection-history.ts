import { ModerationValidationError } from './config.js';
import type { AutomaticModerationFinding, AutomaticModerationFindingKind } from './detection.js';
import type { ModerationPrismaClient, ModerationTransactionClient } from './service.js';

export type ModerationDetectionReviewStatus =
  'unreviewed' | 'confirmed' | 'false_positive' | 'ignored';

export interface ModerationDetectionRecord {
  id: string;
  guildId: string;
  messageId: string;
  channelId: string;
  userId: string;
  detectionKind: AutomaticModerationFindingKind;
  mode: 'observe';
  messageLength: number;
  observedCount: number | null;
  threshold: number | null;
  ruleIndex: number | null;
  reviewStatus: ModerationDetectionReviewStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordModerationDetectionInput {
  guildId: string;
  messageId: string;
  channelId: string;
  userId: string;
  finding: AutomaticModerationFinding;
  occurredAt: Date;
}

export interface ListModerationDetectionsInput {
  guildId: string;
  page?: number;
  pageSize?: number;
  detectionKind?: AutomaticModerationFindingKind;
  reviewStatus?: ModerationDetectionReviewStatus;
  userId?: string;
  channelId?: string;
  from?: Date | null;
  toExclusive?: Date | null;
}

export interface ListModerationDetectionsResult {
  items: ModerationDetectionRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ModerationDetectionStats {
  total: number;
  unreviewed: number;
  confirmed: number;
  falsePositive: number;
  ignored: number;
  reviewed: number;
  falsePositiveRate: number;
  kindCounts: Record<AutomaticModerationFindingKind, number>;
}

export interface ReviewModerationDetectionInput {
  guildId: string;
  detectionId: string;
  actorId: string;
  reviewStatus: ModerationDetectionReviewStatus;
  reviewNote?: string | null;
}

interface ModerationDetectionRow {
  id: string;
  guild_id: string;
  message_id: string;
  channel_id: string;
  user_id: string;
  detection_kind: string;
  mode: string;
  message_length: number;
  observed_count: number | null;
  threshold: number | null;
  rule_index: number | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  occurred_at: Date;
  created_at: Date;
  updated_at: Date;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_REVIEW_NOTE_LENGTH = 500;
const DETECTION_KINDS: AutomaticModerationFindingKind[] = [
  'word_exact',
  'word_contains',
  'word_regex',
  'invite_link',
  'mention_burst',
  'message_burst',
  'duplicate_message',
];
const REVIEW_STATUSES: ModerationDetectionReviewStatus[] = [
  'unreviewed',
  'confirmed',
  'false_positive',
  'ignored',
];
const ALLOWED_DETECTION_KINDS = new Set(DETECTION_KINDS);
const ALLOWED_REVIEW_STATUSES = new Set(REVIEW_STATUSES);

export function createModerationDetectionIdempotencyKey(
  input: Pick<RecordModerationDetectionInput, 'guildId' | 'messageId' | 'finding'>,
): string {
  assertDiscordId(input.guildId, 'Guild ID');
  assertDiscordId(input.messageId, 'Message ID');
  const kind = normalizeDetectionKind(input.finding.kind);
  const ruleIndex = normalizeNullableNonNegativeInteger(input.finding.ruleIndex, 'Rule index');
  return `${input.guildId}:${input.messageId}:${kind}:${ruleIndex ?? 'none'}`;
}

export async function recordModerationDetection(
  prisma: ModerationPrismaClient,
  input: RecordModerationDetectionInput,
): Promise<boolean> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertDiscordId(input.messageId, 'Message ID');
  assertDiscordId(input.channelId, 'Channel ID');
  assertDiscordId(input.userId, 'User ID');
  const detectionKind = normalizeDetectionKind(input.finding.kind);
  const messageLength = normalizeNonNegativeInteger(input.finding.messageLength, '本文長');
  const observedCount = normalizeNullableNonNegativeInteger(input.finding.observedCount, '観測数');
  const threshold = normalizeNullableNonNegativeInteger(input.finding.threshold, '閾値');
  const ruleIndex = normalizeNullableNonNegativeInteger(input.finding.ruleIndex, 'Rule index');
  const occurredAt = normalizeDate(input.occurredAt, '検知日時');
  const idempotencyKey = createModerationDetectionIdempotencyKey(input);

  const inserted = await prisma.$executeRawUnsafe(
    `INSERT INTO moderation_detection_events (
       guild_id,
       message_id,
       channel_id,
       user_id,
       detection_kind,
       mode,
       message_length,
       observed_count,
       threshold,
       rule_index,
       idempotency_key,
       occurred_at
     ) VALUES ($1, $2, $3, $4, $5, 'observe', $6, $7, $8, $9, $10, $11)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    input.guildId,
    input.messageId,
    input.channelId,
    input.userId,
    detectionKind,
    messageLength,
    observedCount,
    threshold,
    ruleIndex,
    idempotencyKey,
    occurredAt,
  );

  return inserted > 0;
}

export async function listModerationDetections(
  prisma: ModerationPrismaClient,
  input: ListModerationDetectionsInput,
): Promise<ListModerationDetectionsResult> {
  assertDiscordId(input.guildId, 'Guild ID');
  const page = positiveInteger(input.page, 1);
  const pageSize = Math.min(positiveInteger(input.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const { where, values } = createDetectionFilters(input);

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count FROM moderation_detection_events WHERE ${where}`,
    ...values,
  );
  const total = Number(countRows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const resolvedPage = Math.min(page, totalPages);
  const queryValues = [...values, pageSize, (resolvedPage - 1) * pageSize];
  const rows = await prisma.$queryRawUnsafe<ModerationDetectionRow[]>(
    `SELECT *
     FROM moderation_detection_events
     WHERE ${where}
     ORDER BY occurred_at DESC, id DESC
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

export async function getModerationDetectionStats(
  prisma: ModerationPrismaClient,
  input: Omit<ListModerationDetectionsInput, 'page' | 'pageSize'>,
): Promise<ModerationDetectionStats> {
  assertDiscordId(input.guildId, 'Guild ID');
  const { where, values } = createDetectionFilters(input);
  const summaryRows = await prisma.$queryRawUnsafe<
    Array<{
      total: bigint | number | string;
      unreviewed: bigint | number | string;
      confirmed: bigint | number | string;
      false_positive: bigint | number | string;
      ignored: bigint | number | string;
    }>
  >(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE review_status = 'unreviewed') AS unreviewed,
       COUNT(*) FILTER (WHERE review_status = 'confirmed') AS confirmed,
       COUNT(*) FILTER (WHERE review_status = 'false_positive') AS false_positive,
       COUNT(*) FILTER (WHERE review_status = 'ignored') AS ignored
     FROM moderation_detection_events
     WHERE ${where}`,
    ...values,
  );
  const kindRows = await prisma.$queryRawUnsafe<
    Array<{ detection_kind: string; count: bigint | number | string }>
  >(
    `SELECT detection_kind, COUNT(*) AS count
     FROM moderation_detection_events
     WHERE ${where}
     GROUP BY detection_kind`,
    ...values,
  );

  const summary = summaryRows[0];
  const confirmed = Number(summary?.confirmed ?? 0);
  const falsePositive = Number(summary?.false_positive ?? 0);
  const ignored = Number(summary?.ignored ?? 0);
  const reviewed = confirmed + falsePositive + ignored;
  const kindCounts = Object.fromEntries(DETECTION_KINDS.map((kind) => [kind, 0])) as Record<
    AutomaticModerationFindingKind,
    number
  >;
  for (const row of kindRows) {
    const kind = normalizeDetectionKind(row.detection_kind);
    kindCounts[kind] = Number(row.count);
  }

  return {
    total: Number(summary?.total ?? 0),
    unreviewed: Number(summary?.unreviewed ?? 0),
    confirmed,
    falsePositive,
    ignored,
    reviewed,
    falsePositiveRate: reviewed === 0 ? 0 : falsePositive / reviewed,
    kindCounts,
  };
}

export async function reviewModerationDetection(
  prisma: ModerationPrismaClient,
  input: ReviewModerationDetectionInput,
): Promise<ModerationDetectionRecord | null> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertUuid(input.detectionId, '検知ID');
  assertDiscordId(input.actorId, '実行者ID');
  const reviewStatus = normalizeReviewStatus(input.reviewStatus);
  const reviewNote = normalizeReviewNote(input.reviewNote);

  return prisma.$transaction(async (tx) => {
    const currentRows = await tx.$queryRawUnsafe<ModerationDetectionRow[]>(
      `SELECT *
       FROM moderation_detection_events
       WHERE guild_id = $1 AND id = $2::uuid
       FOR UPDATE`,
      input.guildId,
      input.detectionId,
    );
    const current = currentRows[0];
    if (!current) return null;

    const reviewed = reviewStatus !== 'unreviewed';
    const rows = await tx.$queryRawUnsafe<ModerationDetectionRow[]>(
      `UPDATE moderation_detection_events
       SET review_status = $1,
           reviewed_by = $2,
           reviewed_at = $3,
           review_note = $4,
           updated_at = NOW()
       WHERE guild_id = $5 AND id = $6::uuid
       RETURNING *`,
      reviewStatus,
      reviewed ? input.actorId : null,
      reviewed ? new Date() : null,
      reviewNote,
      input.guildId,
      input.detectionId,
    );
    const updated = rows[0];
    if (!updated) return null;

    await recordDetectionReviewAudit(tx, input, current, updated);
    return toRecord(updated);
  });
}

export async function pruneModerationDetections(
  prisma: ModerationPrismaClient,
  guildId: string,
  retentionDays: number,
): Promise<number> {
  assertDiscordId(guildId, 'Guild ID');
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650) {
    throw new ModerationValidationError('保持日数は30〜3650日で指定してください');
  }
  return prisma.$executeRawUnsafe(
    `DELETE FROM moderation_detection_events
     WHERE guild_id = $1
       AND occurred_at < NOW() - ($2::text || ' days')::interval`,
    guildId,
    retentionDays,
  );
}

function createDetectionFilters(input: Omit<ListModerationDetectionsInput, 'page' | 'pageSize'>): {
  where: string;
  values: unknown[];
} {
  const values: unknown[] = [input.guildId];
  const filters = ['guild_id = $1'];
  const addFilter = (sql: string, value: unknown) => {
    values.push(value);
    filters.push(sql.replace('?', `$${values.length}`));
  };

  if (input.detectionKind) {
    addFilter('detection_kind = ?', normalizeDetectionKind(input.detectionKind));
  }
  if (input.reviewStatus) {
    addFilter('review_status = ?', normalizeReviewStatus(input.reviewStatus));
  }
  if (input.userId) {
    assertDiscordId(input.userId, 'User ID');
    addFilter('user_id = ?', input.userId);
  }
  if (input.channelId) {
    assertDiscordId(input.channelId, 'Channel ID');
    addFilter('channel_id = ?', input.channelId);
  }
  if (input.from) addFilter('occurred_at >= ?', normalizeDate(input.from, '開始日時'));
  if (input.toExclusive) {
    addFilter('occurred_at < ?', normalizeDate(input.toExclusive, '終了日時'));
  }

  return { where: filters.join(' AND '), values };
}

async function recordDetectionReviewAudit(
  tx: ModerationTransactionClient,
  input: ReviewModerationDetectionInput,
  current: ModerationDetectionRow,
  updated: ModerationDetectionRow,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      guildId: input.guildId,
      actorId: input.actorId,
      event: 'moderation.detection.review',
      targetType: 'moderation_detection',
      targetId: current.id,
      changes: {
        before: { reviewStatus: current.review_status },
        after: { reviewStatus: updated.review_status },
        noteChanged: current.review_note !== updated.review_note,
      },
      metadata: {
        detectionKind: current.detection_kind,
        messageId: current.message_id,
        channelId: current.channel_id,
        userId: current.user_id,
      },
      severity: updated.review_status === 'false_positive' ? 'warning' : 'info',
    },
  });
}

function toRecord(row: ModerationDetectionRow): ModerationDetectionRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    messageId: row.message_id,
    channelId: row.channel_id,
    userId: row.user_id,
    detectionKind: normalizeDetectionKind(row.detection_kind),
    mode: 'observe',
    messageLength: row.message_length,
    observedCount: row.observed_count,
    threshold: row.threshold,
    ruleIndex: row.rule_index,
    reviewStatus: normalizeReviewStatus(row.review_status),
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeDetectionKind(value: unknown): AutomaticModerationFindingKind {
  if (
    typeof value !== 'string' ||
    !ALLOWED_DETECTION_KINDS.has(value as AutomaticModerationFindingKind)
  ) {
    throw new ModerationValidationError('検知種別が不正です');
  }
  return value as AutomaticModerationFindingKind;
}

function normalizeReviewStatus(value: unknown): ModerationDetectionReviewStatus {
  if (
    typeof value !== 'string' ||
    !ALLOWED_REVIEW_STATUSES.has(value as ModerationDetectionReviewStatus)
  ) {
    throw new ModerationValidationError('レビュー状態が不正です');
  }
  return value as ModerationDetectionReviewStatus;
}

function normalizeReviewNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ModerationValidationError('レビュー備考が不正です');
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_REVIEW_NOTE_LENGTH) {
    throw new ModerationValidationError(
      `レビュー備考は${MAX_REVIEW_NOTE_LENGTH}文字以内で入力してください`,
    );
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ModerationValidationError(`${label}が不正です`);
  }
  return value;
}

function normalizeNullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  return normalizeNonNegativeInteger(value, label);
}

function normalizeDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ModerationValidationError(`${label}が不正です`);
  }
  return value;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

function assertDiscordId(value: string, label: string): void {
  if (!/^\d+$/.test(value)) throw new ModerationValidationError(`${label}が不正です`);
}

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ModerationValidationError(`${label}が不正です`);
  }
}
