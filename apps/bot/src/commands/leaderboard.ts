import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getPrismaClient, type PrismaClient } from '@herta/db';
import {
  formatDiscordCommunityLeaderboard,
  getDiscordCommunityLeaderboard,
  resolveDiscordCommunityLeaderboardQuery,
} from '../plugins/community-leaderboard-discord.js';
import {
  formatArcadeLeaderboard,
  listArcadeLeaderboard,
  type ArcadeMetric,
} from '../plugins/mini-games-v3.js';
import type { SlashCommand } from './registry.js';

const prisma = getPrismaClient();

const CATEGORY_CHOICES = [
  { name: 'XP', value: 'xp' },
  { name: 'Level', value: 'level' },
  { name: '発言数 (Messages)', value: 'messages' },
  { name: 'Reaction', value: 'reactions' },
  { name: 'VC滞在時間 (Voice)', value: 'voice' },
  { name: 'Minecraft', value: 'minecraft' },
  { name: '在席時間 (Online)', value: 'online' },
  { name: 'Achievements', value: 'achievements' },
  { name: 'Season Point', value: 'season' },
  { name: 'Mini Games（総勝利）', value: 'minigames' },
];

const PERIOD_CHOICES = [
  { name: '全期間', value: 'all' },
  { name: '今日', value: '1d' },
  { name: '直近7日', value: '7d' },
  { name: '直近30日', value: '30d' },
];

/** カテゴリを所有するPluginのid。未掲載のカテゴリ（messages等）はPluginに依存せず常に利用可能。 */
const CATEGORY_PLUGIN_ID: Partial<Record<string, string>> = {
  xp: 'xp-level',
  level: 'xp-level',
  achievements: 'achievements',
  season: 'community-challenge',
  minigames: 'mini-games',
};

export type CategoryGateResult = { available: true } | { available: false; reason: string };

export async function checkCategoryGate(
  prismaClient: PrismaClient,
  guildId: string,
  category: string,
): Promise<CategoryGateResult> {
  const pluginId = CATEGORY_PLUGIN_ID[category];
  if (!pluginId) return { available: true };

  const row = await prismaClient.guildPlugin.findUnique({
    where: { guildId_pluginId: { guildId, pluginId } },
  });
  if (!row || !row.enabled) {
    return { available: false, reason: `このランキングを表示するPluginが有効化されていません。` };
  }
  const config = (row.config ?? {}) as Record<string, unknown>;
  if (config.enabled === false) {
    return {
      available: false,
      reason: `このランキングを表示するPluginの機能が無効化されています。`,
    };
  }
  if (category === 'minigames' && config.leaderboardEnabled === false) {
    return { available: false, reason: 'Mini GamesのArcade Leaderboardは現在無効です。' };
  }
  return { available: true };
}

export const leaderboardCommand: SlashCommand = {
  definition: {
    name: 'leaderboard',
    description: 'カテゴリを選んでHertaの各種ランキングをまとめて確認します',
    options: [
      {
        name: 'category',
        description: '表示するランキングの種類',
        type: 'string',
        required: true,
        choices: CATEGORY_CHOICES,
      },
      {
        name: 'period',
        description: '集計期間（対応していないカテゴリでは無視されます）',
        type: 'string',
        choices: PERIOD_CHOICES,
      },
      {
        name: 'limit',
        description: '表示人数（5〜25、既定10）',
        type: 'integer',
        minValue: 5,
        maxValue: 25,
      },
    ],
  },
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'サーバー内でのみ利用できます。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const category = interaction.options.getString('category', true);
    const limit = interaction.options.getInteger('limit') ?? 10;

    const gate = await checkCategoryGate(prisma, interaction.guildId, category);
    if (!gate.available) {
      await interaction.reply({ content: gate.reason, flags: MessageFlags.Ephemeral });
      return;
    }

    if (category === 'minigames') {
      const metric: ArcadeMetric = 'minigame_wins';
      const records = await listArcadeLeaderboard(prisma, interaction.guildId, metric, limit);
      await interaction.reply({
        content: `${formatArcadeLeaderboard(metric, records)}\n\n他のArcade指標は \`/gameleaderboard\` で確認できます。`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const query = resolveDiscordCommunityLeaderboardQuery({
      metric: category,
      period: interaction.options.getString('period'),
      limit,
      defaultLimit: 10,
    });
    const snapshot = await getDiscordCommunityLeaderboard(prisma, interaction.guildId, query);
    const content = formatDiscordCommunityLeaderboard(snapshot);

    const embed = new EmbedBuilder().setDescription(content).setColor(0x7c6df2);
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export const leaderboardCommands = [leaderboardCommand];
