import { prisma } from '@/lib/db';

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

export async function getCommunityDashboardSnapshot(
  guildId: string,
): Promise<CommunityDashboardSnapshot> {
  const [row] = await prisma.$queryRaw<
    Array<{
      enabledPlugins: bigint;
      totalPlugins: bigint;
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
      (SELECT COUNT(*) FROM "plugins" WHERE "is_official" = TRUE)::bigint AS "totalPlugins",
      (SELECT COUNT(*) FROM "afk_statuses" WHERE "guild_id" = ${guildId})::bigint AS "afkUsers",
      (SELECT COUNT(*) FROM "polls" WHERE "guild_id" = ${guildId} AND "status" = 'open' AND "ends_at" > CURRENT_TIMESTAMP)::bigint AS "openPolls",
      (SELECT COUNT(*) FROM "giveaways" WHERE "guild_id" = ${guildId} AND "status" = 'open' AND "ends_at" > CURRENT_TIMESTAMP)::bigint AS "openGiveaways",
      (SELECT COUNT(*) FROM "suggestions" WHERE "guild_id" = ${guildId} AND "status" IN ('pending', 'reviewing'))::bigint AS "openSuggestions",
      (SELECT COUNT(*) FROM "reminders" WHERE "guild_id" = ${guildId} AND "status" IN ('pending', 'processing', 'failed'))::bigint AS "pendingReminders",
      (SELECT COUNT(*) FROM "reminders" WHERE "guild_id" = ${guildId} AND "status" = 'failed')::bigint AS "failedReminders",
      (SELECT COUNT(*) FROM "xp_profiles" WHERE "guild_id" = ${guildId})::bigint AS "xpProfiles",
      (SELECT COUNT(*) FROM "command_execution_events" WHERE "guild_id" = ${guildId} AND "executed_at" >= CURRENT_TIMESTAMP - INTERVAL '7 days')::bigint AS "commands7d",
      (SELECT COUNT(*) FROM "command_execution_events" WHERE "guild_id" = ${guildId} AND "executed_at" >= CURRENT_TIMESTAMP - INTERVAL '7 days' AND "status" <> 'success')::bigint AS "failedCommands7d"
  `;

  const commands7d = Number(row?.commands7d ?? 0n);
  const failedCommands7d = Number(row?.failedCommands7d ?? 0n);
  return {
    enabledPlugins: Number(row?.enabledPlugins ?? 0n),
    totalPlugins: Number(row?.totalPlugins ?? 0n),
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
