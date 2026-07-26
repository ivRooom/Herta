import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

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

export interface CommandUsageDay extends CommandUsageCount {
  date: string;
}

export interface CommandUsageRanking extends CommandUsageCount {
  commandName: string;
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
  today: CommandUsageCount;
  last7Days: CommandUsageCount & {
    successRate: number | null;
  };
  daily: CommandUsageDay[];
  ranking: CommandUsageRanking[];
  recentFailures: RecentCommandFailure[];
}

interface CountRow {
  total: number;
  succeeded: number;
  failed: number;
}

interface DailyRow extends CountRow {
  date: string;
}

interface RankingRow extends CountRow {
  commandName: string;
}

interface FailureRow {
  commandName: string;
  errorName: string | null;
  durationMs: number;
  executedAt: Date;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_DAYS = 7;
const MAX_COMMAND_NAME_LENGTH = 100;
const MAX_GUILD_ID_LENGTH = 64;
const MAX_ERROR_NAME_LENGTH = 120;
const MAX_DURATION_MS = 5 * 60 * 1000;

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function normalizeCommandExecutionInput(input: CommandExecutionInput): CommandExecutionInput {
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
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(value);
}

export function fillCommandUsageDays(
  rows: readonly CommandUsageDay[],
  now: Date,
): CommandUsageDay[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const todayStart = startOfJstDay(now);

  return Array.from({ length: ANALYTICS_DAYS }, (_, index) => {
    const date = new Date(todayStart.getTime() - (ANALYTICS_DAYS - 1 - index) * DAY_MS);
    const key = formatJstDate(date);
    return byDate.get(key) ?? { date: key, total: 0, succeeded: 0, failed: 0 };
  });
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

  await prisma.$executeRaw`
    INSERT INTO "command_execution_events" (
      "id",
      "guild_id",
      "command_name",
      "status",
      "duration_ms",
      "error_name",
      "executed_at"
    ) VALUES (
      ${randomUUID()},
      ${normalized.guildId},
      ${normalized.commandName},
      ${normalized.status},
      ${normalized.durationMs},
      ${normalized.errorName ?? null},
      CURRENT_TIMESTAMP
    )
  `;
}

export async function getCommandUsageAnalytics(
  prisma: PrismaClient,
  now = new Date(),
): Promise<CommandUsageAnalytics> {
  const todayStart = startOfJstDay(now);
  const rangeStart = new Date(todayStart.getTime() - (ANALYTICS_DAYS - 1) * DAY_MS);

  const [todayRows, totalRows, dailyRows, rankingRows, failureRows] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${todayStart}
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${rangeStart}
    `,
    prisma.$queryRaw<DailyRow[]>`
      SELECT
        TO_CHAR(("executed_at" AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS "date",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${rangeStart}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<RankingRow[]>`
      SELECT
        "command_name" AS "commandName",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
      FROM "command_execution_events"
      WHERE "executed_at" >= ${rangeStart}
      GROUP BY "command_name"
      ORDER BY "total" DESC, "command_name" ASC
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
      ORDER BY "executed_at" DESC
      LIMIT 10
    `,
  ]);

  const emptyCount: CommandUsageCount = { total: 0, succeeded: 0, failed: 0 };
  const today = todayRows[0] ?? emptyCount;
  const last7Days = totalRows[0] ?? emptyCount;

  return {
    generatedAt: now.toISOString(),
    timeZone: 'Asia/Tokyo',
    today,
    last7Days: {
      ...last7Days,
      successRate: calculateSuccessRate(last7Days),
    },
    daily: fillCommandUsageDays(dailyRows, now),
    ranking: rankingRows,
    recentFailures: failureRows.map((failure) => ({
      ...failure,
      executedAt: failure.executedAt.toISOString(),
    })),
  };
}
