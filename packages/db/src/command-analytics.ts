import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

export type CommandExecutionStatus = 'success' | 'failure';

export interface CommandExecutionInput {
  guildId: string | null;
  commandName: string;
  status: CommandExecutionStatus;
  durationMs: number;
  errorName?: string | null;
}

export interface CommandUsageCount {
  total: number;
  succeeded: number;
  failed: number;
}

export interface CommandUsagePerformance extends CommandUsageCount {
  successRate: number | null;
  averageDurationMs: number;
  p95DurationMs: number;
}

export interface CommandUsageDay extends CommandUsageCount {
  date: string;
}

export interface CommandUsageHour extends CommandUsageCount {
  hour: number;
}

export interface CommandUsageRanking extends CommandUsagePerformance {
  commandName: string;
}

export interface CommandErrorRanking {
  errorName: string;
  total: number;
}

export interface RecentCommandFailure {
  commandName: string;
  errorName: string | null;
  durationMs: number;
  executedAt: string;
}

export interface CommandUsageAnalytics {
  generatedAt: string;
  timeZone: 'Asia/Tokyo';
  rangeDays: number;
  today: CommandUsageCount;
  last7Days: CommandUsageCount & {
    successRate: number | null;
  };
  range: CommandUsagePerformance;
  daily: CommandUsageDay[];
  hourly: CommandUsageHour[];
  ranking: CommandUsageRanking[];
  errors: CommandErrorRanking[];
  recentFailures: RecentCommandFailure[];
}

export interface CommandAnalyticsOptions {
  now?: Date;
  days?: number;
  guildIds?: readonly string[];
}

export interface CommandExecutionSearchFilters {
  query?: string | null;
  status?: CommandExecutionStatus | 'all' | null;
  guildId?: string | null;
  allowedGuildIds?: readonly string[];
  rangeDays?: number;
  page?: number;
  pageSize?: number;
  now?: Date;
}

export interface CommandExecutionHistoryItem {
  id: string;
  guildId: string | null;
  commandName: string;
  status: string;
  durationMs: number;
  errorName: string | null;
  executedAt: string;
}

export interface CommandExecutionSearchResult {
  items: CommandExecutionHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rangeDays: number;
}

interface CountRow {
  total: number;
  succeeded: number;
  failed: number;
}

interface PerformanceRow extends CountRow {
  averageDurationMs: number;
  p95DurationMs: number;
}

interface DailyRow extends CountRow {
  date: string;
}

interface HourlyRow extends CountRow {
  hour: number;
}

interface RankingRow extends PerformanceRow {
  commandName: string;
}

interface ErrorRankingRow {
  errorName: string;
  total: number;
}

interface FailureRow {
  commandName: string;
  errorName: string | null;
  durationMs: number;
  executedAt: Date;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ANALYTICS_DAYS = 7;
const MAX_ANALYTICS_DAYS = 90;
const MAX_COMMAND_NAME_LENGTH = 100;
const MAX_GUILD_ID_LENGTH = 64;
const MAX_ERROR_NAME_LENGTH = 120;
const MAX_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3_650;
const DEFAULT_HISTORY_PAGE_SIZE = 25;
const MAX_HISTORY_PAGE_SIZE = 100;
const MAX_HISTORY_QUERY_LENGTH = 120;

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeGuildIds(guildIds: readonly string[] | undefined): string[] | undefined {
  if (guildIds === undefined) return undefined;
  return [
    ...new Set(guildIds.map((id) => id.trim().slice(0, MAX_GUILD_ID_LENGTH)).filter(Boolean)),
  ];
}

function guildScopeSql(guildIds: readonly string[] | undefined): Prisma.Sql {
  const normalized = normalizeGuildIds(guildIds);
  if (normalized === undefined) return Prisma.sql``;
  if (normalized.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND "guild_id" IN (${Prisma.join(normalized)})`;
}

export function normalizeAnalyticsDays(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_ANALYTICS_DAYS;
  return Math.min(MAX_ANALYTICS_DAYS, Math.max(1, Math.floor(value ?? DEFAULT_ANALYTICS_DAYS)));
}

export function normalizeCommandExecutionInput(
  input: CommandExecutionInput,
): CommandExecutionInput {
  return {
    guildId: normalizeOptionalText(input.guildId, MAX_GUILD_ID_LENGTH),
    commandName:
      normalizeOptionalText(input.commandName, MAX_COMMAND_NAME_LENGTH) ?? 'unknown-command',
    status: input.status,
    durationMs: Math.min(MAX_DURATION_MS, Math.max(0, Math.round(input.durationMs))),
    errorName: normalizeOptionalText(input.errorName, MAX_ERROR_NAME_LENGTH),
  };
}

export function startOfJstDay(value: Date): Date {
  const shifted = value.getTime() + JST_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - JST_OFFSET_MS);
}

function formatJstDate(value: Date): string {
  return new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function fillCommandUsageDays(
  rows: readonly CommandUsageDay[],
  now: Date,
  days = DEFAULT_ANALYTICS_DAYS,
): CommandUsageDay[] {
  const normalizedDays = normalizeAnalyticsDays(days);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const todayStart = startOfJstDay(now);

  return Array.from({ length: normalizedDays }, (_, index) => {
    const date = new Date(todayStart.getTime() - (normalizedDays - 1 - index) * DAY_MS);
    const key = formatJstDate(date);
    return byDate.get(key) ?? { date: key, total: 0, succeeded: 0, failed: 0 };
  });
}

export function fillCommandUsageHours(rows: readonly CommandUsageHour[]): CommandUsageHour[] {
  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from(
    { length: 24 },
    (_, hour) => byHour.get(hour) ?? { hour, total: 0, succeeded: 0, failed: 0 },
  );
}

export function calculateSuccessRate(count: CommandUsageCount): number | null {
  if (count.total === 0) return null;
  return Math.round((count.succeeded / count.total) * 1000) / 10;
}

export async function recordCommandExecution(
  prisma: PrismaClient,
  input: CommandExecutionInput,
): Promise<void> {
  const normalized = normalizeCommandExecutionInput(input);

  await prisma.commandExecutionEvent.create({
    data: {
      id: randomUUID(),
      guildId: normalized.guildId,
      commandName: normalized.commandName,
      status: normalized.status,
      durationMs: normalized.durationMs,
      errorName: normalized.errorName ?? null,
    },
  });
}

export async function pruneCommandExecutionEvents(
  prisma: PrismaClient,
  retentionDays = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  const normalizedRetentionDays = Math.min(
    MAX_RETENTION_DAYS,
    Math.max(1, Math.floor(retentionDays)),
  );
  const cutoff = new Date(Date.now() - normalizedRetentionDays * DAY_MS);
  const result = await prisma.commandExecutionEvent.deleteMany({
    where: { executedAt: { lt: cutoff } },
  });
  return result.count;
}

function toPerformance(row: PerformanceRow | undefined): CommandUsagePerformance {
  const count = row ?? {
    total: 0,
    succeeded: 0,
    failed: 0,
    averageDurationMs: 0,
    p95DurationMs: 0,
  };
  return {
    ...count,
    successRate: calculateSuccessRate(count),
  };
}

export async function getCommandUsageAnalytics(
  prisma: PrismaClient,
  nowOrOptions: Date | CommandAnalyticsOptions = new Date(),
): Promise<CommandUsageAnalytics> {
  const options = nowOrOptions instanceof Date ? { now: nowOrOptions } : nowOrOptions;
  const now = options.now ?? new Date();
  const rangeDays = normalizeAnalyticsDays(options.days);
  const todayStart = startOfJstDay(now);
  const last7DaysStart = new Date(todayStart.getTime() - 6 * DAY_MS);
  const rangeStart = new Date(todayStart.getTime() - (rangeDays - 1) * DAY_MS);
  const guildScope = guildScopeSql(options.guildIds);

  const [
    todayRows,
    last7DaysRows,
    rangeRows,
    dailyRows,
    hourlyRows,
    rankingRows,
    errorRows,
    failureRows,
  ] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${todayStart}
      ${guildScope}
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${last7DaysStart}
      ${guildScope}
    `,
    prisma.$queryRaw<PerformanceRow[]>`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed",
        COALESCE(ROUND(AVG("duration_ms"))::int, 0) AS "averageDurationMs",
        COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "duration_ms"))::int, 0) AS "p95DurationMs"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${rangeStart}
      ${guildScope}
    `,
    prisma.$queryRaw<DailyRow[]>`
      SELECT
        TO_CHAR(("executed_at" AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS "date",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${rangeStart}
      ${guildScope}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<HourlyRow[]>`
      SELECT
        EXTRACT(HOUR FROM "executed_at" AT TIME ZONE 'Asia/Tokyo')::int AS "hour",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${rangeStart}
      ${guildScope}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<RankingRow[]>`
      SELECT
        "command_name" AS "commandName",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed",
        COALESCE(ROUND(AVG("duration_ms"))::int, 0) AS "averageDurationMs",
        COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "duration_ms"))::int, 0) AS "p95DurationMs"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${rangeStart}
      ${guildScope}
      GROUP BY "command_name"
      ORDER BY "total" DESC, "command_name" ASC
      LIMIT 10
    `,
    prisma.$queryRaw<ErrorRankingRow[]>`
      SELECT
        COALESCE(NULLIF("error_name", ''), 'UnknownError') AS "errorName",
        COUNT(*)::int AS "total"
      FROM "command_execution_events"
      WHERE "status" = 'failure'
        AND "executed_at" >= ${rangeStart}
        ${guildScope}
      GROUP BY 1
      ORDER BY "total" DESC, "errorName" ASC
      LIMIT 8
    `,
    prisma.$queryRaw<FailureRow[]>`
      SELECT
        "command_name" AS "commandName",
        "error_name" AS "errorName",
        "duration_ms" AS "durationMs",
        "executed_at" AS "executedAt"
      FROM "command_execution_events"
      WHERE "status" = 'failure'
        AND "executed_at" >= ${rangeStart}
        ${guildScope}
      ORDER BY "executed_at" DESC
      LIMIT 10
    `,
  ]);

  const emptyCount: CommandUsageCount = { total: 0, succeeded: 0, failed: 0 };
  const today = todayRows[0] ?? emptyCount;
  const last7Days = last7DaysRows[0] ?? emptyCount;

  return {
    generatedAt: now.toISOString(),
    timeZone: 'Asia/Tokyo',
    rangeDays,
    today,
    last7Days: {
      ...last7Days,
      successRate: calculateSuccessRate(last7Days),
    },
    range: toPerformance(rangeRows[0]),
    daily: fillCommandUsageDays(dailyRows, now, rangeDays),
    hourly: fillCommandUsageHours(hourlyRows),
    ranking: rankingRows.map((row) => ({
      ...row,
      successRate: calculateSuccessRate(row),
    })),
    errors: errorRows,
    recentFailures: failureRows.map((failure) => ({
      ...failure,
      executedAt: failure.executedAt.toISOString(),
    })),
  };
}

function normalizeSearchPage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value ?? 1));
}

function normalizeSearchPageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_HISTORY_PAGE_SIZE;
  return Math.min(
    MAX_HISTORY_PAGE_SIZE,
    Math.max(1, Math.floor(value ?? DEFAULT_HISTORY_PAGE_SIZE)),
  );
}

export async function searchCommandExecutionEvents(
  prisma: PrismaClient,
  filters: CommandExecutionSearchFilters = {},
): Promise<CommandExecutionSearchResult> {
  const now = filters.now ?? new Date();
  const rangeDays = normalizeAnalyticsDays(filters.rangeDays);
  const rangeStart = new Date(startOfJstDay(now).getTime() - (rangeDays - 1) * DAY_MS);
  const query = normalizeOptionalText(filters.query, MAX_HISTORY_QUERY_LENGTH);
  const guildId = normalizeOptionalText(filters.guildId, MAX_GUILD_ID_LENGTH);
  const allowedGuildIds = normalizeGuildIds(filters.allowedGuildIds);
  const status =
    filters.status === 'success' || filters.status === 'failure' ? filters.status : null;
  const page = normalizeSearchPage(filters.page);
  const pageSize = normalizeSearchPageSize(filters.pageSize);

  const where: Prisma.CommandExecutionEventWhereInput = {
    executedAt: { gte: rangeStart },
    ...(status ? { status } : {}),
    ...(guildId ? { guildId } : {}),
    ...(allowedGuildIds ? { AND: [{ guildId: { in: allowedGuildIds } }] } : {}),
    ...(query
      ? {
          OR: [
            { commandName: { contains: query, mode: 'insensitive' } },
            { guildId: { contains: query, mode: 'insensitive' } },
            { errorName: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.commandExecutionEvent.count({ where }),
    prisma.commandExecutionEvent.findMany({
      where,
      orderBy: [{ executedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        guildId: true,
        commandName: true,
        status: true,
        durationMs: true,
        errorName: true,
        executedAt: true,
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      executedAt: row.executedAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rangeDays,
  };
}
