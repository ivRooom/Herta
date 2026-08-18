import {
  calculateSuccessRate,
  fillCommandUsageDays,
  startOfJstDay,
  type CommandUsageDay,
} from '@herta/db';
import { getAllPluginManifests } from '@herta/plugin-catalog';
import { prisma } from '@/lib/db';
import {
  resolveCommunityCommandRangeWindow,
  type CommunityCommandRange,
} from '@/lib/community-dashboard-range';

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface CommunityDashboardSnapshot {
  enabledPlugins: number;
  totalPlugins: number;
  afkUsers: number;
  openPolls: number;
  openGiveaways: number;
  openSuggestions: number;
  pendingReminders: number;
  failedReminders: number;
  xpProfiles: number;
  commands7d: number;
  failedCommands7d: number;
  commandSuccessRate7d: number;
}

export interface CommunityCommandWindow {
  range: CommunityCommandRange;
  label: string;
  total: number;
  failed: number;
  successRate: number;
  daily: CommandUsageDay[];
}

export async function getCommunityDashboardSnapshot(
  guildId: string,
  now = new Date(),
): Promise<CommunityDashboardSnapshot> {
  const last7DaysStart = new Date(startOfJstDay(now).getTime() - 6 * DAY_MS);
  const [row] = await prisma.$queryRaw<
    Array<{
      enabledPlugins: bigint;
      afkUsers: bigint;
      openPolls: bigint;
      openGiveaways: bigint;
      openSuggestions: bigint;
      pendingReminders: bigint;
      failedReminders: bigint;
      xpProfiles: bigint;
      commands7d: bigint;
      failedCommands7d: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "guild_plugins" WHERE "guild_id" = ${guildId} AND "enabled" = TRUE)::bigint AS "enabledPlugins",
      (SELECT COUNT(*) FROM "afk_statuses" WHERE "guild_id" = ${guildId})::bigint AS "afkUsers",
      (SELECT COUNT(*) FROM "polls" WHERE "guild_id" = ${guildId} AND "status" = 'open' AND "ends_at" > CURRENT_TIMESTAMP)::bigint AS "openPolls",
      (SELECT COUNT(*) FROM "giveaways" WHERE "guild_id" = ${guildId} AND "status" = 'open' AND "ends_at" > CURRENT_TIMESTAMP)::bigint AS "openGiveaways",
      (SELECT COUNT(*) FROM "suggestions" WHERE "guild_id" = ${guildId} AND "status" IN ('pending', 'reviewing'))::bigint AS "openSuggestions",
      (SELECT COUNT(*) FROM "reminders" WHERE "guild_id" = ${guildId} AND "status" IN ('pending', 'processing', 'failed'))::bigint AS "pendingReminders",
      (SELECT COUNT(*) FROM "reminders" WHERE "guild_id" = ${guildId} AND "status" = 'failed')::bigint AS "failedReminders",
      (SELECT COUNT(*) FROM "xp_profiles" WHERE "guild_id" = ${guildId})::bigint AS "xpProfiles",
      (SELECT COUNT(*) FROM "command_execution_events" WHERE "guild_id" = ${guildId} AND "executed_at" >= ${last7DaysStart} AND "executed_at" < ${now})::bigint AS "commands7d",
      (SELECT COUNT(*) FROM "command_execution_events" WHERE "guild_id" = ${guildId} AND "executed_at" >= ${last7DaysStart} AND "executed_at" < ${now} AND "status" <> 'success')::bigint AS "failedCommands7d"
  `;

  const commands7d = Number(row?.commands7d ?? 0n);
  const failedCommands7d = Number(row?.failedCommands7d ?? 0n);
  return {
    enabledPlugins: Number(row?.enabledPlugins ?? 0n),
    totalPlugins: getAllPluginManifests().length,
    afkUsers: Number(row?.afkUsers ?? 0n),
    openPolls: Number(row?.openPolls ?? 0n),
    openGiveaways: Number(row?.openGiveaways ?? 0n),
    openSuggestions: Number(row?.openSuggestions ?? 0n),
    pendingReminders: Number(row?.pendingReminders ?? 0n),
    failedReminders: Number(row?.failedReminders ?? 0n),
    xpProfiles: Number(row?.xpProfiles ?? 0n),
    commands7d,
    failedCommands7d,
    commandSuccessRate7d:
      commands7d === 0 ? 100 : Math.round(((commands7d - failedCommands7d) / commands7d) * 100),
  };
}

export async function getCommunityCommandWindow(
  guildId: string,
  range: CommunityCommandRange,
  now = new Date(),
): Promise<CommunityCommandWindow> {
  const window = resolveCommunityCommandRangeWindow(range, now);
  const rows = await prisma.$queryRaw<CommandUsageDay[]>`
    SELECT
      TO_CHAR(("executed_at" AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS "date",
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE "status" = 'success')::int AS "succeeded",
      COUNT(*) FILTER (WHERE "status" = 'failure')::int AS "failed"
    FROM "command_execution_events"
    WHERE "guild_id" = ${guildId}
      AND "executed_at" >= ${window.startAt}
      AND "executed_at" < ${now}
    GROUP BY 1
    ORDER BY 1
  `;
  const total = rows.reduce((sum, day) => sum + day.total, 0);
  const succeeded = rows.reduce((sum, day) => sum + day.succeeded, 0);
  const failed = rows.reduce((sum, day) => sum + day.failed, 0);

  return {
    range,
    label: window.label,
    total,
    failed,
    successRate: calculateSuccessRate({ total, succeeded, failed }) ?? 100,
    daily: fillCommandUsageDays(rows, now, window.chartDays),
  };
}
