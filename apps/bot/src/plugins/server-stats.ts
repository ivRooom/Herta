import type { PrismaClient } from '@herta/db';
import { getPluginManifest, serverStatsManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  getServerActivityMetrics,
  getServerContentMetrics,
  listEnabledPlugins,
  type EnabledPluginSummary,
  type ServerActivityMetrics,
  type ServerContentMetrics,
} from './server-stats-repository.js';

const EPHEMERAL_FLAG = 64;
const MAX_PAGE_LENGTH = 1900;

export interface ServerStatsConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  adminOnly: boolean;
  includeBots: boolean;
  activityWindowDays: number;
  showZeroMetrics: boolean;
  showCommunityMetrics: boolean;
  showContentMetrics: boolean;
  showPluginSummary: boolean;
}

interface ServerStatsOptions {
  getSubcommand(): string;
}

interface CachedMember {
  user?: { bot?: boolean };
}

interface MemberCache {
  size: number;
  values(): IterableIterator<CachedMember>;
}

interface ServerGuild {
  name: string;
  memberCount: number;
  channels: { cache: { size: number } };
  roles: { cache: { size: number } };
  members?: { cache: MemberCache };
}

interface ServerStatsInteraction {
  guildId: string | null;
  guild: ServerGuild | null;
  memberPermissions?: { has(permission: string): boolean } | null;
  options: ServerStatsOptions;
  reply(options: ReplyOptions): Promise<unknown>;
  followUp(options: ReplyOptions): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

type ServerStatsContext = PluginRuntimeContext<ServerStatsConfig, unknown, PrismaClient>;

export const serverStatsPlugin = definePlugin<ServerStatsConfig, unknown, PrismaClient>({
  manifest: serverStatsManifest,
  provideCommands(context) {
    const command: CommandHandler<ServerStatsInteraction> = {
      definition: serverStatsManifest.commands[0]!,
      async execute(interaction) {
        await executeServerCommand(context, interaction);
      },
    };
    return [command];
  },
});

export function normalizeServerStatsConfig(value: unknown): ServerStatsConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? false : source.ephemeralResponses === true,
    adminOnly: source.adminOnly === true,
    includeBots: source.includeBots === undefined ? true : source.includeBots === true,
    activityWindowDays: clamp(toInteger(source.activityWindowDays, 7), 1, 30),
    showZeroMetrics: source.showZeroMetrics === true,
    showCommunityMetrics:
      source.showCommunityMetrics === undefined ? true : source.showCommunityMetrics === true,
    showContentMetrics:
      source.showContentMetrics === undefined ? true : source.showContentMetrics === true,
    showPluginSummary:
      source.showPluginSummary === undefined ? true : source.showPluginSummary === true,
  };
}

export function formatServerStats(
  guild: ServerGuild,
  metrics: ServerContentMetrics,
  config: ServerStatsConfig,
): string {
  const memberResult = resolveMemberCount(guild, config.includeBots);
  const lines = [
    `**📊 ${guild.name} Server Stats**`,
    `メンバー: **${memberResult.count.toLocaleString()}**${memberResult.note}`,
    `チャンネル: **${guild.channels.cache.size.toLocaleString()}**`,
    `Role: **${Math.max(0, guild.roles.cache.size - 1).toLocaleString()}**`,
  ];

  if (config.showCommunityMetrics) {
    appendMetric(lines, 'AFK中', metrics.afkUsers, config.showZeroMetrics);
    appendMetric(lines, '有効Rule', metrics.enabledRules, config.showZeroMetrics);
  }
  if (config.showContentMetrics) {
    appendMetric(lines, '開催中Poll', metrics.openPolls, config.showZeroMetrics);
    appendMetric(lines, '開催中Giveaway', metrics.openGiveaways, config.showZeroMetrics);
    appendMetric(lines, '未処理Suggestion', metrics.openSuggestions, config.showZeroMetrics);
    appendMetric(lines, '待機中Reminder', metrics.pendingReminders, config.showZeroMetrics);
  }
  if (config.showPluginSummary) {
    appendMetric(lines, '有効Plugin', metrics.enabledPlugins, true);
  }
  return lines.join('\n');
}

export function formatServerActivity(metrics: ServerActivityMetrics, days: number): string {
  const successRate =
    metrics.commands > 0 ? Math.round((metrics.successfulCommands / metrics.commands) * 100) : 100;
  return [
    `**📈 最近${days}日間のActivity**`,
    `コマンド実行: **${metrics.commands.toLocaleString()}**`,
    `成功率: **${successRate}%** (${metrics.successfulCommands.toLocaleString()}成功 / ${metrics.failedCommands.toLocaleString()}失敗)`,
    `新規Suggestion: **${metrics.suggestionsCreated.toLocaleString()}**`,
    `新規Poll: **${metrics.pollsCreated.toLocaleString()}**`,
    `新規Giveaway: **${metrics.giveawaysCreated.toLocaleString()}**`,
  ].join('\n');
}

export function formatPluginPages(plugins: readonly EnabledPluginSummary[]): string[] {
  if (plugins.length === 0) return ['有効なPluginはありません。'];
  const lines = plugins.map((plugin) => {
    const manifest = getPluginManifest(plugin.id);
    const commands = (manifest?.commands ?? []).map((command) => `/${command.name}`).join(' ');
    return `• **${plugin.name}** \`${plugin.id}\` v${plugin.version}${commands ? ` — ${commands}` : ''}`;
  });
  return paginate('**🧩 有効Plugin**', lines);
}

async function executeServerCommand(
  context: ServerStatsContext,
  interaction: ServerStatsInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await reply(context, interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }

  const config = normalizeServerStatsConfig(context.config);
  if (!config.enabled) {
    await reply(context, interaction, 'Server Stats Pluginは現在無効です。');
    return;
  }
  if (config.adminOnly && !interaction.memberPermissions?.has('ManageGuild')) {
    await reply(context, interaction, 'この統計はManage Server権限を持つメンバーだけ閲覧できます。');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'stats') {
    const metrics = await getServerContentMetrics(context.prisma, interaction.guildId);
    await reply(context, interaction, formatServerStats(interaction.guild, metrics, config));
    return;
  }
  if (subcommand === 'activity') {
    const since = new Date(Date.now() - config.activityWindowDays * 86_400_000);
    const metrics = await getServerActivityMetrics(context.prisma, interaction.guildId, since);
    await reply(
      context,
      interaction,
      formatServerActivity(metrics, config.activityWindowDays),
    );
    return;
  }
  if (subcommand === 'plugins') {
    const plugins = await listEnabledPlugins(context.prisma, interaction.guildId);
    await replyPages(context, interaction, formatPluginPages(plugins));
    return;
  }

  await reply(context, interaction, '不明なServer Stats操作です。');
}

function resolveMemberCount(
  guild: ServerGuild,
  includeBots: boolean,
): { count: number; note: string } {
  if (includeBots) return { count: guild.memberCount, note: '' };
  const cache = guild.members?.cache;
  if (!cache || cache.size !== guild.memberCount) {
    return { count: guild.memberCount, note: '（Bot除外にはMembers Intentが必要）' };
  }
  let humans = 0;
  for (const member of cache.values()) {
    if (!member.user?.bot) humans += 1;
  }
  return { count: humans, note: '（Bot除外）' };
}

async function reply(
  context: ServerStatsContext,
  interaction: ServerStatsInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    flags: normalizeServerStatsConfig(context.config).ephemeralResponses
      ? EPHEMERAL_FLAG
      : undefined,
    allowedMentions: { parse: [] },
  });
}

async function replyPages(
  context: ServerStatsContext,
  interaction: ServerStatsInteraction,
  pages: readonly string[],
): Promise<void> {
  const flags = normalizeServerStatsConfig(context.config).ephemeralResponses
    ? EPHEMERAL_FLAG
    : undefined;
  await interaction.reply({ content: pages[0] ?? '表示する項目がありません。', flags, allowedMentions: { parse: [] } });
  for (const page of pages.slice(1)) {
    await interaction.followUp({ content: page, flags, allowedMentions: { parse: [] } });
  }
}

function appendMetric(lines: string[], label: string, value: number, showZero: boolean): void {
  if (value === 0 && !showZero) return;
  lines.push(`${label}: **${value.toLocaleString()}**`);
}

function paginate(title: string, lines: readonly string[]): string[] {
  const pages: string[] = [];
  let current = title;
  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length > MAX_PAGE_LENGTH) {
      pages.push(current);
      current = `${title}（続き）\n${line}`;
    } else {
      current = next;
    }
  }
  pages.push(current);
  return pages;
}

function toInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
