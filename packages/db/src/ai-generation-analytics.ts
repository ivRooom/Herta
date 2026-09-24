import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

export type AiGenerationResultCategory = 'success' | 'rejected' | 'failed';

export interface AiGenerationEventInput {
  guildId: string;
  provider: string;
  model: string;
  modelProfile: string;
  feature: string;
  resultCategory: AiGenerationResultCategory;
  errorCategory?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

export interface AiUsageCount {
  total: number;
  succeeded: number;
  failed: number;
}

export interface AiUsageDay extends AiUsageCount {
  date: string;
}

export interface AiProviderUsage {
  provider: string;
  total: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiErrorRanking {
  errorCategory: string;
  total: number;
}

export interface AiUsageAnalytics {
  generatedAt: string;
  timeZone: 'Asia/Tokyo';
  rangeDays: number;
  today: AiUsageCount;
  last7Days: AiUsageCount & { successRate: number | null };
  range: AiUsageCount & { successRate: number | null; estimatedCostUsd: number };
  daily: AiUsageDay[];
  byProvider: AiProviderUsage[];
  errors: AiErrorRanking[];
}

export interface AiUsageAnalyticsOptions {
  now?: Date;
  days?: number;
  guildIds?: readonly string[];
}

interface CountRow {
  total: number;
  succeeded: number;
  failed: number;
}

interface DailyRow extends CountRow {
  date: string;
}

interface ProviderRow extends CountRow {
  provider: string;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface ErrorRankingRow {
  errorCategory: string;
  total: number;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ANALYTICS_DAYS = 7;
const MAX_ANALYTICS_DAYS = 90;
const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3_650;
const MAX_GUILD_ID_LENGTH = 64;
const MAX_TEXT_LENGTH = 100;
const MAX_DURATION_MS = 10 * 60 * 1000;
const MAX_TOKENS = 10_000_000;
const MAX_COST_USD = 1_000;

function normalizeText(value: string, maxLength: number, fallback: string): string {
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || fallback;
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

function normalizeNonNegativeInt(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

function normalizeGuildIds(guildIds: readonly string[] | undefined): string[] | undefined {
  if (guildIds === undefined) return undefined;
  return [
    ...new Set(guildIds.map((id) => id.trim().slice(0, MAX_GUILD_ID_LENGTH)).filter(Boolean)),
  ];
}

export function normalizeAiAnalyticsDays(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_ANALYTICS_DAYS;
  return Math.min(MAX_ANALYTICS_DAYS, Math.max(1, Math.floor(value ?? DEFAULT_ANALYTICS_DAYS)));
}

export function normalizeAiGenerationEventInput(
  input: AiGenerationEventInput,
): AiGenerationEventInput {
  return {
    guildId: normalizeText(input.guildId, MAX_GUILD_ID_LENGTH, 'unknown-guild'),
    provider: normalizeText(input.provider, MAX_TEXT_LENGTH, 'unknown-provider'),
    model: normalizeText(input.model, MAX_TEXT_LENGTH, 'unknown-model'),
    modelProfile: normalizeText(input.modelProfile, MAX_TEXT_LENGTH, 'unknown-profile'),
    feature: normalizeText(input.feature, MAX_TEXT_LENGTH, 'unknown-feature'),
    resultCategory: input.resultCategory,
    errorCategory: normalizeOptionalText(input.errorCategory, MAX_TEXT_LENGTH),
    inputTokens: normalizeNonNegativeInt(input.inputTokens, MAX_TOKENS),
    outputTokens: normalizeNonNegativeInt(input.outputTokens, MAX_TOKENS),
    totalTokens: normalizeNonNegativeInt(input.totalTokens, MAX_TOKENS),
    estimatedCostUsd: Math.min(MAX_COST_USD, Math.max(0, input.estimatedCostUsd)),
    durationMs: normalizeNonNegativeInt(input.durationMs, MAX_DURATION_MS),
  };
}

function startOfJstDay(value: Date): Date {
  const shifted = value.getTime() + JST_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - JST_OFFSET_MS);
}

function formatJstDate(value: Date): string {
  return new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function fillAiUsageDays(
  rows: readonly AiUsageDay[],
  now: Date,
  days = DEFAULT_ANALYTICS_DAYS,
): AiUsageDay[] {
  const normalizedDays = normalizeAiAnalyticsDays(days);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const todayStart = startOfJstDay(now);

  return Array.from({ length: normalizedDays }, (_, index) => {
    const date = new Date(todayStart.getTime() - (normalizedDays - 1 - index) * DAY_MS);
    const key = formatJstDate(date);
    return byDate.get(key) ?? { date: key, total: 0, succeeded: 0, failed: 0 };
  });
}

export function calculateAiSuccessRate(count: AiUsageCount): number | null {
  if (count.total === 0) return null;
  return Math.round((count.succeeded / count.total) * 1000) / 10;
}

export async function recordAiGenerationEvent(
  prisma: PrismaClient,
  input: AiGenerationEventInput,
): Promise<void> {
  const normalized = normalizeAiGenerationEventInput(input);

  await prisma.aiGenerationEvent.create({
    data: {
      id: randomUUID(),
      guildId: normalized.guildId,
      provider: normalized.provider,
      model: normalized.model,
      modelProfile: normalized.modelProfile,
      feature: normalized.feature,
      resultCategory: normalized.resultCategory,
      errorCategory: normalized.errorCategory,
      inputTokens: normalized.inputTokens,
      outputTokens: normalized.outputTokens,
      totalTokens: normalized.totalTokens,
      estimatedCostUsd: normalized.estimatedCostUsd,
      durationMs: normalized.durationMs,
    },
  });
}

export async function pruneAiGenerationEvents(
  prisma: PrismaClient,
  retentionDays = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  const normalizedRetentionDays = Math.min(
    MAX_RETENTION_DAYS,
    Math.max(1, Math.floor(retentionDays)),
  );
  const cutoff = new Date(Date.now() - normalizedRetentionDays * DAY_MS);
  const result = await prisma.aiGenerationEvent.deleteMany({
    where: { occurredAt: { lt: cutoff } },
  });
  return result.count;
}

function guildScopeSql(guildIds: readonly string[] | undefined): Prisma.Sql {
  const normalized = normalizeGuildIds(guildIds);
  if (normalized === undefined) return Prisma.sql``;
  if (normalized.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND "guild_id" IN (${Prisma.join(normalized)})`;
}

export async function getAiUsageAnalytics(
  prisma: PrismaClient,
  nowOrOptions: Date | AiUsageAnalyticsOptions = new Date(),
): Promise<AiUsageAnalytics> {
  const options = nowOrOptions instanceof Date ? { now: nowOrOptions } : nowOrOptions;
  const now = options.now ?? new Date();
  const rangeDays = normalizeAiAnalyticsDays(options.days);
  const todayStart = startOfJstDay(now);
  const last7DaysStart = new Date(todayStart.getTime() - 6 * DAY_MS);
  const rangeStart = new Date(todayStart.getTime() - (rangeDays - 1) * DAY_MS);
  const guildScope = guildScopeSql(options.guildIds);

  const [todayRows, last7DaysRows, rangeRows, dailyRows, providerRows, errorRows] =
    await Promise.all([
      prisma.$queryRaw<CountRow[]>`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "result_category" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "result_category" != 'success')::int AS "failed"
      FROM "ai_generation_events"
      WHERE "occurred_at" >= ${todayStart}
      ${guildScope}
    `,
      prisma.$queryRaw<CountRow[]>`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "result_category" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "result_category" != 'success')::int AS "failed"
      FROM "ai_generation_events"
      WHERE "occurred_at" >= ${last7DaysStart}
      ${guildScope}
    `,
      prisma.$queryRaw<Array<CountRow & { estimatedCostUsd: number }>>`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "result_category" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "result_category" != 'success')::int AS "failed",
        COALESCE(SUM("estimated_cost_usd"), 0)::float AS "estimatedCostUsd"
      FROM "ai_generation_events"
      WHERE "occurred_at" >= ${rangeStart}
      ${guildScope}
    `,
      prisma.$queryRaw<DailyRow[]>`
      SELECT
        TO_CHAR(("occurred_at" AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS "date",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "result_category" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "result_category" != 'success')::int AS "failed"
      FROM "ai_generation_events"
      WHERE "occurred_at" >= ${rangeStart}
      ${guildScope}
      GROUP BY 1
      ORDER BY 1
    `,
      prisma.$queryRaw<ProviderRow[]>`
      SELECT
        "provider" AS "provider",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "result_category" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "result_category" != 'success')::int AS "failed",
        COALESCE(SUM("estimated_cost_usd"), 0)::float AS "estimatedCostUsd",
        COALESCE(SUM("input_tokens"), 0)::int AS "inputTokens",
        COALESCE(SUM("output_tokens"), 0)::int AS "outputTokens"
      FROM "ai_generation_events"
      WHERE "occurred_at" >= ${rangeStart}
      ${guildScope}
      GROUP BY "provider"
      ORDER BY "total" DESC, "provider" ASC
    `,
      prisma.$queryRaw<ErrorRankingRow[]>`
      SELECT
        COALESCE("error_category", 'unknown') AS "errorCategory",
        COUNT(*)::int AS "total"
      FROM "ai_generation_events"
      WHERE "result_category" != 'success'
        AND "occurred_at" >= ${rangeStart}
        ${guildScope}
      GROUP BY 1
      ORDER BY "total" DESC, "errorCategory" ASC
      LIMIT 8
    `,
    ]);

  const emptyCount: AiUsageCount = { total: 0, succeeded: 0, failed: 0 };
  const today = todayRows[0] ?? emptyCount;
  const last7Days = last7DaysRows[0] ?? emptyCount;
  const range = rangeRows[0] ?? { ...emptyCount, estimatedCostUsd: 0 };

  return {
    generatedAt: now.toISOString(),
    timeZone: 'Asia/Tokyo',
    rangeDays,
    today,
    last7Days: {
      ...last7Days,
      successRate: calculateAiSuccessRate(last7Days),
    },
    range: {
      ...range,
      successRate: calculateAiSuccessRate(range),
    },
    daily: fillAiUsageDays(dailyRows, now, rangeDays),
    byProvider: providerRows.map((row) => ({
      ...row,
      successRate: calculateAiSuccessRate(row),
    })),
    errors: errorRows,
  };
}
