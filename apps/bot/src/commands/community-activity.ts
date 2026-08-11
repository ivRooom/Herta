import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getPrismaClient } from '@herta/db';
import {
  getCommunityActivityTotals,
  getCommunityLeaderboard,
  getCommunityUserRank,
  type CommunityActivityMetric,
  type CommunityActivityPeriod,
  type CommunityUserRank,
} from '../activity/community-activity.js';
import type { SlashCommand } from './registry.js';

const prisma = getPrismaClient();

const metricLabels: Record<CommunityActivityMetric, string> = {
  messages: '発言数',
  reactions_given: 'リアクション数',
  reactions_received: 'もらったリアクション',
  voice_seconds: 'VC滞在時間',
  minecraft_seconds: 'Minecraftプレイ時間',
};

const periodLabels: Record<CommunityActivityPeriod, string> = {
  today: '今日',
  '7d': '7日間',
  '30d': '30日間',
  all: '全期間',
};

const periodChoices = [
  { name: '今日', value: 'today' },
  { name: '7日間', value: '7d' },
  { name: '30日間', value: '30d' },
  { name: '全期間', value: 'all' },
];

const metricChoices = [
  { name: '発言数', value: 'messages' },
  { name: 'リアクション数', value: 'reactions_given' },
  { name: 'もらったリアクション', value: 'reactions_received' },
  { name: 'VC滞在時間', value: 'voice_seconds' },
  { name: 'Minecraftプレイ時間', value: 'minecraft_seconds' },
];

function readPeriod(value: string | null): CommunityActivityPeriod {
  return value === 'today' || value === '30d' || value === 'all' ? value : '7d';
}

function readMetric(value: string | null): CommunityActivityMetric {
  if (
    value === 'reactions_given' ||
    value === 'reactions_received' ||
    value === 'voice_seconds' ||
    value === 'minecraft_seconds'
  ) {
    return value;
  }
  return 'messages';
}

function formatMetric(metric: CommunityActivityMetric, value: number): string {
  if (metric === 'voice_seconds' || metric === 'minecraft_seconds') {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return `${hours}時間${minutes}分`;
  }
  return value.toLocaleString('ja-JP');
}

function displayName(interaction: Parameters<SlashCommand['execute']>[0], userId: string): string {
  const member = interaction.guild?.members.cache.get(userId);
  return member?.displayName ?? `<@${userId}>`;
}

function formatRank(metric: CommunityActivityMetric, value: CommunityUserRank): string {
  if (value.rank === null) return '記録なし';
  return `**#${value.rank} / ${value.participants}人**\n${formatMetric(metric, value.total)}`;
}

export const leaderboardCommand: SlashCommand = {
  definition: {
    name: 'leaderboard',
    description: 'コミュニティ活動ランキングを表示します',
    options: [
      {
        name: 'metric',
        description: 'ランキング指標',
        type: 'string',
        choices: metricChoices,
      },
      {
        name: 'period',
        description: '集計期間',
        type: 'string',
        choices: periodChoices,
      },
      {
        name: 'limit',
        description: '表示人数（1〜25）',
        type: 'integer',
        minValue: 1,
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

    const metric = readMetric(interaction.options.getString('metric'));
    const period = readPeriod(interaction.options.getString('period'));
    const limit = interaction.options.getInteger('limit') ?? 10;
    const rows = await getCommunityLeaderboard(prisma, interaction.guildId, metric, period, limit);

    const description = rows.length
      ? rows
          .map(
            (row, index) =>
              `**${index + 1}.** ${displayName(interaction, row.userId)} — **${formatMetric(metric, row.total)}**`,
          )
          .join('\n')
      : 'この期間の活動データはまだありません。';

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${metricLabels[metric]} リーダーボード`)
      .setDescription(description)
      .setColor(0x7c6df2)
      .setFooter({ text: `${periodLabels[period]} · 最大${limit}人` });

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export const activityCommand: SlashCommand = {
  definition: {
    name: 'activity',
    description: '自分またはメンバーのコミュニティ活動を表示します',
    options: [
      {
        name: 'user',
        description: '確認するユーザー。省略時は自分',
        type: 'user',
      },
      {
        name: 'period',
        description: '集計期間',
        type: 'string',
        choices: periodChoices,
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
    const period = readPeriod(interaction.options.getString('period'));
    const totals = await getCommunityActivityTotals(prisma, interaction.guildId, user.id, period);

    const embed = new EmbedBuilder()
      .setTitle(`📈 ${user.globalName ?? user.username} のアクティビティ`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setColor(0x5865f2)
      .addFields(
        {
          name: '💬 発言',
          value: totals.messages.toLocaleString('ja-JP'),
          inline: true,
        },
        {
          name: '✨ リアクション',
          value: totals.reactionsGiven.toLocaleString('ja-JP'),
          inline: true,
        },
        {
          name: '💜 もらったリアクション',
          value: totals.reactionsReceived.toLocaleString('ja-JP'),
          inline: true,
        },
        {
          name: '🎙️ VC',
          value: formatMetric('voice_seconds', totals.voiceSeconds),
          inline: true,
        },
      )
      .setFooter({ text: `${periodLabels[period]}の集計 · /rank で順位を確認` });

    if (totals.minecraftSeconds > 0) {
      embed.addFields({
        name: '⛏️ Minecraft',
        value: formatMetric('minecraft_seconds', totals.minecraftSeconds),
        inline: true,
      });
    }

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export const rankCommand: SlashCommand = {
  definition: {
    name: 'rank',
    description: '自分またはメンバーのコミュニティ内順位を表示します',
    options: [
      {
        name: 'user',
        description: '確認するユーザー。省略時は自分',
        type: 'user',
      },
      {
        name: 'period',
        description: '集計期間',
        type: 'string',
        choices: periodChoices,
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
    const period = readPeriod(interaction.options.getString('period'));
    const metrics: CommunityActivityMetric[] = [
      'messages',
      'voice_seconds',
      'reactions_given',
      'reactions_received',
      'minecraft_seconds',
    ];
    const ranks = await Promise.all(
      metrics.map((metric) => getCommunityUserRank(prisma, interaction.guildId!, user.id, metric, period)),
    );

    const embed = new EmbedBuilder()
      .setTitle(`🏅 ${user.globalName ?? user.username} の順位`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setColor(0xf1c40f)
      .addFields(
        { name: '💬 発言', value: formatRank('messages', ranks[0]!), inline: true },
        { name: '🎙️ VC', value: formatRank('voice_seconds', ranks[1]!), inline: true },
        { name: '✨ リアクション', value: formatRank('reactions_given', ranks[2]!), inline: true },
        {
          name: '💜 もらったリアクション',
          value: formatRank('reactions_received', ranks[3]!),
          inline: true,
        },
      )
      .setFooter({ text: `${periodLabels[period]}の順位 · 同値は現在の集計順で表示` });

    if (ranks[4]!.rank !== null) {
      embed.addFields({
        name: '⛏️ Minecraft',
        value: formatRank('minecraft_seconds', ranks[4]!),
        inline: true,
      });
    }

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export const communityActivityCommands = [leaderboardCommand, activityCommand, rankCommand];
