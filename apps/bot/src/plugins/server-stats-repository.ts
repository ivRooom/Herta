import type { PrismaClient } from '@herta/db';

export interface ServerContentMetrics {
  afkUsers: number;
  openPolls: number;
  openGiveaways: number;
  openSuggestions: number;
  pendingReminders: number;
  enabledPlugins: number;
  enabledRules: number;
}

export interface ServerActivityMetrics {
  commands: number;
  successfulCommands: number;
  failedCommands: number;
  suggestionsCreated: number;
  pollsCreated: number;
  giveawaysCreated: number;
}

export interface EnabledPluginSummary {
  id: string;
  name: string;
  version: string;
}

export async function getServerContentMetrics(
  prisma: PrismaClient,
  guildId: string,
): Promise<ServerContentMetrics> {
  const [row] = await prisma.$queryRaw<
    Array<{
      afkUsers: bigint;
      openPolls: bigint;
      openGiveaways: bigint;
      openSuggestions: bigint;
      pendingReminders: bigint;
      enabledPlugins: bigint;
      enabledRules: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "afk_statuses" WHERE "guild_id" = ${guildId})::bigint AS "afkUsers",
      (SELECT COUNT(*) FROM "polls" WHERE "guild_id" = ${guildId} AND "status" = 'open' AND "ends_at" > CURRENT_TIMESTAMP)::bigint AS "openPolls",
      (SELECT COUNT(*) FROM "giveaways" WHERE "guild_id" = ${guildId} AND "status" = 'open' AND "ends_at" > CURRENT_TIMESTAMP)::bigint AS "openGiveaways",
      (SELECT COUNT(*) FROM "suggestions" WHERE "guild_id" = ${guildId} AND "status" IN ('pending', 'reviewing'))::bigint AS "openSuggestions",
      (SELECT COUNT(*) FROM "reminders" WHERE "guild_id" = ${guildId} AND "status" IN ('pending', 'processing', 'failed'))::bigint AS "pendingReminders",
      (SELECT COUNT(*) FROM "guild_plugins" WHERE "guild_id" = ${guildId} AND "enabled" = TRUE)::bigint AS "enabledPlugins",
      (SELECT COUNT(*) FROM "rules" WHERE "guild_id" = ${guildId} AND "enabled" = TRUE)::bigint AS "enabledRules"
  `;

  return {
    afkUsers: Number(row?.afkUsers ?? 0n),
    openPolls: Number(row?.openPolls ?? 0n),
    openGiveaways: Number(row?.openGiveaways ?? 0n),
    openSuggestions: Number(row?.openSuggestions ?? 0n),
    pendingReminders: Number(row?.pendingReminders ?? 0n),
    enabledPlugins: Number(row?.enabledPlugins ?? 0n),
    enabledRules: Number(row?.enabledRules ?? 0n),
  };
}

export async function getServerActivityMetrics(
  prisma: PrismaClient,
  guildId: string,
  since: Date,
): Promise<ServerActivityMetrics> {
  const [row] = await prisma.$queryRaw<
    Array<{
      commands: bigint;
      successfulCommands: bigint;
      failedCommands: bigint;
      suggestionsCreated: bigint;
      pollsCreated: bigint;
      giveawaysCreated: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "command_execution_events" WHERE "guild_id" = ${guildId} AND "executed_at" >= ${since})::bigint AS "commands",
      (SELECT COUNT(*) FROM "command_execution_events" WHERE "guild_id" = ${guildId} AND "executed_at" >= ${since} AND "status" = 'success')::bigint AS "successfulCommands",
      (SELECT COUNT(*) FROM "command_execution_events" WHERE "guild_id" = ${guildId} AND "executed_at" >= ${since} AND "status" <> 'success')::bigint AS "failedCommands",
      (SELECT COUNT(*) FROM "suggestions" WHERE "guild_id" = ${guildId} AND "created_at" >= ${since})::bigint AS "suggestionsCreated",
      (SELECT COUNT(*) FROM "polls" WHERE "guild_id" = ${guildId} AND "created_at" >= ${since})::bigint AS "pollsCreated",
      (SELECT COUNT(*) FROM "giveaways" WHERE "guild_id" = ${guildId} AND "created_at" >= ${since})::bigint AS "giveawaysCreated"
  `;

  return {
    commands: Number(row?.commands ?? 0n),
    successfulCommands: Number(row?.successfulCommands ?? 0n),
    failedCommands: Number(row?.failedCommands ?? 0n),
    suggestionsCreated: Number(row?.suggestionsCreated ?? 0n),
    pollsCreated: Number(row?.pollsCreated ?? 0n),
    giveawaysCreated: Number(row?.giveawaysCreated ?? 0n),
  };
}

export async function listEnabledPlugins(
  prisma: PrismaClient,
  guildId: string,
): Promise<EnabledPluginSummary[]> {
  return prisma.$queryRaw<EnabledPluginSummary[]>`
    SELECT p."id", p."name", p."version"
    FROM "guild_plugins" gp
    JOIN "plugins" p ON p."id" = gp."plugin_id"
    WHERE gp."guild_id" = ${guildId} AND gp."enabled" = TRUE
    ORDER BY p."name" ASC, p."id" ASC
  `;
}
