import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getPrismaClient } from '@herta/db';
import { getCommunitySeasonWindow } from '@herta/shared';
import {
  getAchievementMetrics,
  type AchievementMetrics,
} from '../plugins/achievements-repository.js';
import type { SlashCommand } from './registry.js';

const prisma = getPrismaClient();

export function buildCommunityStatsFields(
  metrics: AchievementMetrics,
): Array<{ name: string; value: string; inline: boolean }> {
  return [
    {
      name: '🗳️ 投票したPoll数',
      value: metrics.pollVotes.toLocaleString('ja-JP'),
      inline: true,
    },
    {
      name: '🎁 参加したGiveaway数',
      value: metrics.giveawayEntries.toLocaleString('ja-JP'),
      inline: true,
    },
    {
      name: '📅 参加予定のEvent数',
      value: metrics.eventGoing.toLocaleString('ja-JP'),
      inline: true,
    },
    {
      name: '💡 提案数',
      value: metrics.suggestions.toLocaleString('ja-JP'),
      inline: true,
    },
    {
      name: '✅ 採用された提案数',
      value: metrics.acceptedSuggestions.toLocaleString('ja-JP'),
      inline: true,
    },
    {
      name: '🏆 チャレンジ達成数',
      value: metrics.challengeCompletions.toLocaleString('ja-JP'),
      inline: true,
    },
  ];
}

export const communityStatsCommand: SlashCommand = {
  definition: {
    name: 'community-stats',
    description: '投票・Giveaway参加・Event RSVP・提案・チャレンジなどの個人統計を表示します',
    options: [
      {
        name: 'user',
        description: '確認するユーザー。省略時は自分',
        type: 'user',
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

    const user = interaction.options.getUser('user') ?? interaction.user;
    const metrics = await getAchievementMetrics(prisma, interaction.guildId, user.id);
    const season = getCommunitySeasonWindow();

    const embed = new EmbedBuilder()
      .setTitle(`🎯 ${user.globalName ?? user.username} のコミュニティ参加統計`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setColor(0x2ecc71)
      .addFields(...buildCommunityStatsFields(metrics), {
        name: `🌟 シーズン#${season.index} ポイント`,
        value: metrics.seasonPoints.toLocaleString('ja-JP'),
        inline: true,
      })
      .setFooter({ text: '/activity で発言・リアクション・VC等の活動統計も確認できます' });

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export const communityStatsCommands = [communityStatsCommand];
