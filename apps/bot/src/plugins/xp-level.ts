import type { PrismaClient } from '@herta/db';
import { xpLevelManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import { isCommandLikeMessage } from '../activity/activity-rules.js';
import { awardMessageXp, type XpProfileRecord } from './xp-level-repository.js';
import {
  formatDiscordCommunityLeaderboard,
  formatDiscordCommunityRank,
  getDiscordCommunityLeaderboard,
  getDiscordCommunityRank,
  resolveDiscordCommunityLeaderboardQuery,
} from './community-leaderboard-discord.js';

const EPHEMERAL_FLAG = 64;
const DISCORD_ID_PATTERN = /^\d+$/;
const DEFAULT_COMMAND_PREFIXES = ['/', '!'] as const;

export interface XpLevelConfig {
  enabled: boolean;
  xpPerMessage: number;
  cooldownSeconds: number;
  excludedChannelIds: string[];
  excludedRoleIds: string[];
  excludeCommandMessages: boolean;
  commandPrefixes: string[];
  levelUpNotification: boolean;
  levelUpChannelId: string | null;
  leaderboardSize: number;
  reward1Level: number;
  reward1RoleId: string | null;
  reward2Level: number;
  reward2RoleId: string | null;
  reward3Level: number;
  reward3RoleId: string | null;
}

export interface XpMessageCandidate {
  channelId: string;
  content?: string;
  hasExcludedRole: boolean;
}

interface XpCommandInteraction {
  guildId: string | null;
  user: { id: string };
  options: {
    getUser(name: string): { id: string } | null;
    getString(name: string): string | null;
    getInteger(name: string): number | null;
  };
  reply(options: ReplyOptions): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

interface XpRole {
  id: string;
  editable: boolean;
}

interface XpChannel {
  isTextBased(): boolean;
  send(options: {
    content: string;
    allowedMentions: { parse: []; users?: string[] };
  }): Promise<unknown>;
}

interface XpMemberRoles {
  cache: { has(roleId: string): boolean };
  add(roleId: string): Promise<unknown>;
}

interface XpMessage {
  guildId: string | null;
  channelId: string;
  content?: string;
  author: { id: string; bot?: boolean };
  member: { roles: XpMemberRoles } | null;
  guild: {
    roles: { fetch(roleId: string): Promise<XpRole | null> };
    channels: { fetch(channelId: string): Promise<XpChannel | null> };
  } | null;
  reply(options: {
    content: string;
    allowedMentions: { parse: []; users?: string[] };
  }): Promise<unknown>;
}

type XpRuntimeContext = PluginRuntimeContext<XpLevelConfig, unknown, PrismaClient>;

export const xpLevelPlugin = definePlugin<XpLevelConfig, unknown, PrismaClient>({
  manifest: xpLevelManifest,
  provideCommands(context) {
    const rank: CommandHandler<XpCommandInteraction> = {
      definition: xpLevelManifest.commands[0]!,
      async execute(interaction) {
        await executeRank(context, interaction);
      },
    };
    const leaderboard: CommandHandler<XpCommandInteraction> = {
      definition: xpLevelManifest.commands[1]!,
      async execute(interaction) {
        await executeLeaderboard(context, interaction);
      },
    };
    return [rank, leaderboard];
  },
  provideEvents() {
    return [
      {
        event: 'messageCreate',
        async handler(context, ...args) {
          await handleXpMessage(context as XpRuntimeContext, args[0] as XpMessage | undefined);
        },
      },
    ] as PluginEventHandler<XpLevelConfig>[];
  },
});

export function normalizeXpLevelConfig(value: unknown): XpLevelConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    xpPerMessage: clamp(toInteger(source.xpPerMessage, 10), 1, 100),
    cooldownSeconds: clamp(toInteger(source.cooldownSeconds, 60), 5, 600),
    excludedChannelIds: normalizedIds(source.excludedChannelIds, 25),
    excludedRoleIds: normalizedIds(source.excludedRoleIds, 25),
    excludeCommandMessages: source.excludeCommandMessages === true,
    commandPrefixes: normalizedCommandPrefixes(source.commandPrefixes),
    levelUpNotification:
      source.levelUpNotification === undefined ? true : source.levelUpNotification === true,
    levelUpChannelId: nullableDiscordId(source.levelUpChannelId),
    leaderboardSize: clamp(toInteger(source.leaderboardSize, 10), 5, 25),
    reward1Level: clamp(toInteger(source.reward1Level, 5), 1, 999),
    reward1RoleId: nullableDiscordId(source.reward1RoleId),
    reward2Level: clamp(toInteger(source.reward2Level, 10), 1, 999),
    reward2RoleId: nullableDiscordId(source.reward2RoleId),
    reward3Level: clamp(toInteger(source.reward3Level, 20), 1, 999),
    reward3RoleId: nullableDiscordId(source.reward3RoleId),
  };
}

export function shouldAwardXpForMessage(
  config: XpLevelConfig,
  candidate: XpMessageCandidate,
): boolean {
  if (!config.enabled) return false;
  if (config.excludedChannelIds.includes(candidate.channelId)) return false;
  if (candidate.hasExcludedRole) return false;
  if (
    config.excludeCommandMessages &&
    candidate.content !== undefined &&
    isCommandLikeMessage(candidate.content, config.commandPrefixes)
  ) {
    return false;
  }
  return true;
}

export function levelForXp(xp: number): number {
  return Math.max(0, Math.floor(Math.sqrt(Math.max(0, xp) / 100)));
}

export function xpRequiredForLevel(level: number): number {
  const safeLevel = Math.max(0, Math.trunc(level));
  return safeLevel * safeLevel * 100;
}

export function formatRankMessage(
  profile: XpProfileRecord | null,
  rank: number | null,
  userId: string,
): string {
  return formatXpRankMessage(profile?.xp ?? 0, rank, userId);
}

export function formatLeaderboard(records: readonly XpProfileRecord[]): string {
  if (records.length === 0) return 'まだXPデータがありません。';
  const lines = records.map(
    (record, index) =>
      `${index + 1}. <@${record.userId}> — Lv.${levelForXp(record.xp)} / ${record.xp.toLocaleString()} XP`,
  );
  return ['**🏆 XP Leaderboard**', ...lines].join('\n');
}

async function executeRank(
  context: XpRuntimeContext,
  interaction: XpCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeXpLevelConfig(context.config);
  if (!config.enabled) {
    await reply(interaction, 'XP / Level Pluginは現在無効です。');
    return;
  }

  const targetUserId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  const query = resolveDiscordCommunityLeaderboardQuery({
    metric: interaction.options.getString('metric'),
    period: interaction.options.getString('period'),
    defaultLimit: config.leaderboardSize,
  });
  const snapshot = await getDiscordCommunityRank(
    context.prisma,
    interaction.guildId,
    targetUserId,
    query,
  );
  const content =
    query.metric === 'xp'
      ? formatXpRankMessage(snapshot.value, snapshot.rank, targetUserId)
      : formatDiscordCommunityRank(snapshot);

  await interaction.reply({
    content,
    allowedMentions: { parse: [] },
  });
}

async function executeLeaderboard(
  context: XpRuntimeContext,
  interaction: XpCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeXpLevelConfig(context.config);
  if (!config.enabled) {
    await reply(interaction, 'XP / Level Pluginは現在無効です。');
    return;
  }

  const query = resolveDiscordCommunityLeaderboardQuery({
    metric: interaction.options.getString('metric'),
    period: interaction.options.getString('period'),
    limit: interaction.options.getInteger('limit'),
    defaultLimit: config.leaderboardSize,
  });
  const snapshot = await getDiscordCommunityLeaderboard(context.prisma, interaction.guildId, query);
  await interaction.reply({
    content: formatDiscordCommunityLeaderboard(snapshot),
    allowedMentions: { parse: [] },
  });
}

function formatXpRankMessage(xpValue: number, rank: number | null, userId: string): string {
  const xp = Math.max(0, Math.trunc(xpValue));
  const level = levelForXp(xp);
  const currentFloor = xpRequiredForLevel(level);
  const nextTarget = xpRequiredForLevel(level + 1);
  const progress = xp - currentFloor;
  const needed = Math.max(1, nextTarget - currentFloor);
  const percentage = Math.min(100, Math.floor((progress / needed) * 100));
  return [
    `**<@${userId}> のRank**`,
    `Level: **${level}**`,
    `XP: **${xp.toLocaleString()}**`,
    `次のLevelまで: **${progress.toLocaleString()} / ${needed.toLocaleString()} XP (${percentage}%)**`,
    `サーバー順位: **${rank ? `#${rank}` : '未ランク'}**`,
  ].join('\n');
}

async function handleXpMessage(
  context: XpRuntimeContext,
  message: XpMessage | undefined,
): Promise<void> {
  if (!message?.guildId || message.author.bot) return;
  const config = normalizeXpLevelConfig(context.config);
  const hasExcludedRole = Boolean(
    message.member &&
      config.excludedRoleIds.some((roleId) => message.member!.roles.cache.has(roleId)),
  );
  if (
    !shouldAwardXpForMessage(config, {
      channelId: message.channelId,
      content: message.content,
      hasExcludedRole,
    })
  ) {
    return;
  }

  const result = await awardMessageXp(context.prisma, {
    guildId: message.guildId,
    userId: message.author.id,
    amount: config.xpPerMessage,
    cooldownSeconds: config.cooldownSeconds,
  });
  if (!result.awarded) return;

  const previousLevel = levelForXp(Math.max(0, result.xp - config.xpPerMessage));
  const nextLevel = levelForXp(result.xp);
  if (nextLevel <= previousLevel) return;

  await grantReachedRewardRoles(context, message, config, nextLevel);
  if (config.levelUpNotification) {
    await sendLevelUpNotification(context, message, config, nextLevel);
  }
}

async function grantReachedRewardRoles(
  context: XpRuntimeContext,
  message: XpMessage,
  config: XpLevelConfig,
  level: number,
): Promise<void> {
  if (!message.member || !message.guild) return;
  const rewards = [
    { level: config.reward1Level, roleId: config.reward1RoleId },
    { level: config.reward2Level, roleId: config.reward2RoleId },
    { level: config.reward3Level, roleId: config.reward3RoleId },
  ].filter((reward): reward is { level: number; roleId: string } => Boolean(reward.roleId));

  for (const reward of rewards) {
    if (reward.level > level || message.member.roles.cache.has(reward.roleId)) continue;
    try {
      const role = await message.guild.roles.fetch(reward.roleId);
      if (!role?.editable) {
        context.logger.warn(
          { guildId: message.guildId, roleId: reward.roleId, userId: message.author.id },
          'Level Roleを編集できないため付与をスキップしました',
        );
        continue;
      }
      await message.member.roles.add(reward.roleId);
    } catch (error) {
      context.logger.warn(
        { err: error, guildId: message.guildId, roleId: reward.roleId, userId: message.author.id },
        'Level Roleの付与に失敗しました',
      );
    }
  }
}

async function sendLevelUpNotification(
  context: XpRuntimeContext,
  message: XpMessage,
  config: XpLevelConfig,
  level: number,
): Promise<void> {
  const options = {
    content: `🎉 <@${message.author.id}> が **Level ${level}** になりました！`,
    allowedMentions: { parse: [] as [], users: [message.author.id] },
  };
  try {
    if (config.levelUpChannelId && message.guild) {
      const channel = await message.guild.channels.fetch(config.levelUpChannelId);
      if (channel?.isTextBased()) {
        await channel.send(options);
        return;
      }
    }
    await message.reply(options);
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: message.guildId, userId: message.author.id },
      'レベルアップ通知の送信に失敗しました',
    );
  }
}

async function reply(interaction: XpCommandInteraction, content: string): Promise<void> {
  await interaction.reply({
    content,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  });
}

function normalizedIds(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === 'string' && DISCORD_ID_PATTERN.test(item),
      ),
    ),
  ].slice(0, maxItems);
}

function normalizedCommandPrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_COMMAND_PREFIXES];
  const prefixes = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 5 && !/\s/u.test(item)),
    ),
  ].slice(0, 10);
  return prefixes.length > 0 ? prefixes : [...DEFAULT_COMMAND_PREFIXES];
}

function nullableDiscordId(value: unknown): string | null {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value) ? value : null;
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
