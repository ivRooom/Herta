import type { PrismaClient } from '@herta/db';
import { achievementsManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  getAchievementMetrics,
  listAchievementUnlocks,
  syncAchievementUnlocks,
  type AchievementMetrics,
  type AchievementUnlockRecord,
} from './achievements-repository.js';

const EPHEMERAL_FLAG = 64;

type MetricKey = keyof AchievementMetrics;
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  emoji: string;
  rarity: Rarity;
  metric: MetricKey;
  target: number;
  secret?: boolean;
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    id: 'first-steps',
    name: 'First Steps',
    description: '100 XPを獲得する',
    emoji: '🌱',
    rarity: 'common',
    metric: 'xp',
    target: 100,
  },
  {
    id: 'getting-active',
    name: 'Getting Active',
    description: '1,000 XPを獲得する',
    emoji: '⚡',
    rarity: 'uncommon',
    metric: 'xp',
    target: 1000,
  },
  {
    id: 'server-regular',
    name: 'Server Regular',
    description: '5,000 XPを獲得する',
    emoji: '🔥',
    rarity: 'rare',
    metric: 'xp',
    target: 5000,
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: '20,000 XPを獲得する',
    emoji: '👑',
    rarity: 'legendary',
    metric: 'xp',
    target: 20000,
  },
  {
    id: 'first-vote',
    name: 'First Vote',
    description: 'Pollへ1回参加する',
    emoji: '🗳️',
    rarity: 'common',
    metric: 'pollVotes',
    target: 1,
  },
  {
    id: 'voice-of-community',
    name: 'Voice of Community',
    description: 'Pollへ10回参加する',
    emoji: '📊',
    rarity: 'rare',
    metric: 'pollVotes',
    target: 10,
  },
  {
    id: 'feeling-lucky',
    name: 'Feeling Lucky',
    description: 'Giveawayへ1回参加する',
    emoji: '🎁',
    rarity: 'common',
    metric: 'giveawayEntries',
    target: 1,
  },
  {
    id: 'event-goer',
    name: 'Event Goer',
    description: 'Eventへ3回参加表明する',
    emoji: '🎟️',
    rarity: 'uncommon',
    metric: 'eventGoing',
    target: 3,
  },
  {
    id: 'community-regular',
    name: 'Community Regular',
    description: 'Eventへ10回参加表明する',
    emoji: '🎉',
    rarity: 'epic',
    metric: 'eventGoing',
    target: 10,
  },
  {
    id: 'idea-maker',
    name: 'Idea Maker',
    description: 'Suggestionを1件投稿する',
    emoji: '💡',
    rarity: 'common',
    metric: 'suggestions',
    target: 1,
  },
  {
    id: 'change-maker',
    name: 'Change Maker',
    description: 'Suggestionが1件採用または完了になる',
    emoji: '🛠️',
    rarity: 'rare',
    metric: 'acceptedSuggestions',
    target: 1,
  },
  {
    id: 'community-legend',
    name: 'Community Legend',
    description: '複数のコミュニティ活動を極める',
    emoji: '🌌',
    rarity: 'legendary',
    metric: 'acceptedSuggestions',
    target: 5,
    secret: true,
  },
];

export interface AchievementsConfig {
  enabled: boolean;
  ephemeralSync: boolean;
  showLocked: boolean;
  showProgress: boolean;
  hideSecretUntilUnlocked: boolean;
  pageSize: number;
}

interface AchievementCommandInteraction {
  guildId: string | null;
  user: { id: string };
  options: {
    getUser(name: string): { id: string } | null;
    getString(name: string, required?: boolean): string | null;
    getSubcommand(): string;
  };
  reply(options: ReplyOptions): Promise<unknown>;
  followUp(options: ReplyOptions): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

type AchievementsRuntimeContext = PluginRuntimeContext<AchievementsConfig, unknown, PrismaClient>;

export const achievementsPlugin = definePlugin<AchievementsConfig, unknown, PrismaClient>({
  manifest: achievementsManifest,
  provideCommands(context) {
    const list: CommandHandler<AchievementCommandInteraction> = {
      definition: achievementsManifest.commands[0]!,
      async execute(interaction) {
        await executeAchievements(context, interaction);
      },
    };
    const manage: CommandHandler<AchievementCommandInteraction> = {
      definition: achievementsManifest.commands[1]!,
      async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'sync') await executeSync(context, interaction);
        else if (subcommand === 'info') await executeInfo(context, interaction);
      },
    };
    return [list, manage];
  },
});

export function normalizeAchievementsConfig(value: unknown): AchievementsConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralSync: source.ephemeralSync === undefined ? true : source.ephemeralSync === true,
    showLocked: source.showLocked === undefined ? true : source.showLocked === true,
    showProgress: source.showProgress === undefined ? true : source.showProgress === true,
    hideSecretUntilUnlocked:
      source.hideSecretUntilUnlocked === undefined ? true : source.hideSecretUntilUnlocked === true,
    pageSize: clamp(toInteger(source.pageSize, 10), 5, 20),
  };
}

export function unlockedAchievementIds(metrics: AchievementMetrics): string[] {
  const base = ACHIEVEMENTS.filter((achievement) => {
    if (achievement.id === 'community-legend') {
      return (
        metrics.xp >= 5000 &&
        metrics.pollVotes >= 10 &&
        metrics.eventGoing >= 10 &&
        metrics.acceptedSuggestions >= 5
      );
    }
    return metrics[achievement.metric] >= achievement.target;
  });
  return base.map((achievement) => achievement.id);
}

export function formatAchievements(
  userId: string,
  metrics: AchievementMetrics,
  unlocks: readonly AchievementUnlockRecord[],
  config: AchievementsConfig,
): string[] {
  const unlocked = new Map(unlocks.map((record) => [record.achievementId, record.unlockedAt]));
  const visible = ACHIEVEMENTS.filter((achievement) => {
    if (unlocked.has(achievement.id)) return true;
    if (!config.showLocked) return false;
    return !(achievement.secret && config.hideSecretUntilUnlocked);
  });
  const lines = visible.map((achievement) => {
    const unlockedAt = unlocked.get(achievement.id);
    if (unlockedAt) {
      return `${achievement.emoji} **${achievement.name}** · ${rarityLabel(achievement.rarity)} · ✅ 解除済み`;
    }
    const current = achievement.id === 'community-legend' ? 0 : metrics[achievement.metric];
    const progress = config.showProgress
      ? ` · ${Math.min(current, achievement.target).toLocaleString()}/${achievement.target.toLocaleString()}`
      : '';
    return `🔒 **${achievement.name}** · ${rarityLabel(achievement.rarity)}${progress}`;
  });
  const header = `**🏅 <@${userId}> のAchievements — ${unlocks.length}/${ACHIEVEMENTS.length} unlocked**`;
  if (lines.length === 0) return [[header, 'まだ表示できる実績がありません。'].join('\n')];
  return chunkLines(header, lines, config.pageSize);
}

async function loadAndSync(
  context: AchievementsRuntimeContext,
  guildId: string,
  userId: string,
): Promise<{
  metrics: AchievementMetrics;
  unlocks: AchievementUnlockRecord[];
  newlyUnlocked: string[];
}> {
  const metrics = await getAchievementMetrics(context.prisma, guildId, userId);
  const newlyUnlocked = await syncAchievementUnlocks(
    context.prisma,
    guildId,
    userId,
    unlockedAchievementIds(metrics),
  );
  const unlocks = await listAchievementUnlocks(context.prisma, guildId, userId);
  return { metrics, unlocks, newlyUnlocked };
}

async function executeAchievements(
  context: AchievementsRuntimeContext,
  interaction: AchievementCommandInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeAchievementsConfig(context.config);
  if (!config.enabled) return reply(interaction, 'Achievements Pluginは現在無効です。');
  const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  const { metrics, unlocks } = await loadAndSync(context, interaction.guildId, userId);
  const pages = formatAchievements(userId, metrics, unlocks, config);
  await interaction.reply({ content: pages[0]!, allowedMentions: { parse: [] } });
  for (const page of pages.slice(1)) {
    await interaction.followUp({ content: page, allowedMentions: { parse: [] } });
  }
}

async function executeSync(
  context: AchievementsRuntimeContext,
  interaction: AchievementCommandInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeAchievementsConfig(context.config);
  if (!config.enabled) return reply(interaction, 'Achievements Pluginは現在無効です。');
  const { newlyUnlocked, unlocks } = await loadAndSync(
    context,
    interaction.guildId,
    interaction.user.id,
  );
  const names = newlyUnlocked.map((id) => ACHIEVEMENTS.find((item) => item.id === id)?.name ?? id);
  const content =
    names.length > 0
      ? `🏅 **${names.length}個のAchievementを新しく解除しました！**\n${names.map((name) => `• ${name}`).join('\n')}\n現在 ${unlocks.length}/${ACHIEVEMENTS.length}`
      : `同期しました。新しい解除はありません。現在 ${unlocks.length}/${ACHIEVEMENTS.length} です。`;
  await interaction.reply({
    content,
    flags: config.ephemeralSync ? EPHEMERAL_FLAG : undefined,
    allowedMentions: { parse: [] },
  });
}

async function executeInfo(
  context: AchievementsRuntimeContext,
  interaction: AchievementCommandInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeAchievementsConfig(context.config);
  if (!config.enabled) return reply(interaction, 'Achievements Pluginは現在無効です。');
  const id = interaction.options.getString('id', true)?.trim().toLowerCase() ?? '';
  const achievement = ACHIEVEMENTS.find((item) => item.id === id);
  if (!achievement)
    return reply(
      interaction,
      'そのAchievement IDは見つかりません。`/achievements`で一覧を確認してください。',
    );
  const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  const { metrics, unlocks } = await loadAndSync(context, interaction.guildId, userId);
  const unlocked = unlocks.find((record) => record.achievementId === id);
  if (achievement.secret && config.hideSecretUntilUnlocked && !unlocked) {
    return reply(interaction, '🌌 **Secret Achievement**\n条件は解除するまで非公開です。');
  }
  const current = achievement.id === 'community-legend' ? undefined : metrics[achievement.metric];
  await interaction.reply({
    content: [
      `${achievement.emoji} **${achievement.name}**`,
      `ID: \`${achievement.id}\``,
      `Rarity: **${rarityLabel(achievement.rarity)}**`,
      achievement.description,
      unlocked
        ? `Status: ✅ 解除済み · <t:${Math.floor(unlocked.unlockedAt.getTime() / 1000)}:R>`
        : `Status: 🔒 未解除${current === undefined ? '' : ` · ${Math.min(current, achievement.target).toLocaleString()}/${achievement.target.toLocaleString()}`}`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  });
}

function chunkLines(header: string, lines: string[], pageSize: number): string[] {
  const pages: string[] = [];
  for (let index = 0; index < lines.length; index += pageSize) {
    const page = lines.slice(index, index + pageSize);
    pages.push(
      [pages.length === 0 ? header : `${header} · continued`, ...page].join('\n').slice(0, 1990),
    );
  }
  return pages;
}

function rarityLabel(rarity: Rarity): string {
  return {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary',
  }[rarity];
}

async function reply(interaction: AchievementCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: EPHEMERAL_FLAG, allowedMentions: { parse: [] } });
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
