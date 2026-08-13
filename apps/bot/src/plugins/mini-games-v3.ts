import type { ChatInputCommandInteraction } from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { miniGamesManifest } from '@herta/plugin-catalog';
import type { CommandHandler } from '@herta/plugin-sdk';
import {
  compareChinchiroHands,
  formatChinchiroHand,
  isChinchiroSpecial,
  rollChinchiroTurn,
  rollDice,
} from './mini-games-v3-core.js';

const ARCADE_METRICS = [
  'minigame_wins',
  'minigame_plays',
  'coinflip_wins',
  'highlow_best_streak',
  'blackjack_wins',
  'chinchiro_wins',
  'dice_sixes',
] as const;

type ArcadeMetric = (typeof ARCADE_METRICS)[number];

type MiniGamesV3Context = {
  guildId: string;
  config: unknown;
  prisma: PrismaClient;
};

interface ArcadeLeaderboardRecord {
  userId: string;
  value: number;
}

export function createMiniGamesV3CommandHandlers(
  context: MiniGamesV3Context,
): CommandHandler<ChatInputCommandInteraction>[] {
  const dice: CommandHandler<ChatInputCommandInteraction> = {
    definition: miniGamesManifest.commands[4]!,
    async execute(interaction) {
      await executeDice(context, interaction);
    },
  };
  const chinchiro: CommandHandler<ChatInputCommandInteraction> = {
    definition: miniGamesManifest.commands[5]!,
    async execute(interaction) {
      await executeChinchiro(context, interaction);
    },
  };
  const leaderboard: CommandHandler<ChatInputCommandInteraction> = {
    definition: miniGamesManifest.commands[6]!,
    async execute(interaction) {
      await executeArcadeLeaderboard(context, interaction);
    },
  };
  return [dice, chinchiro, leaderboard];
}

export function arcadeMetricLabel(metric: ArcadeMetric): string {
  const labels: Record<ArcadeMetric, string> = {
    minigame_wins: '総勝利',
    minigame_plays: '総プレイ',
    coinflip_wins: 'Coin Flip 的中',
    highlow_best_streak: 'High-Low 最高連勝',
    blackjack_wins: 'Blackjack 勝利',
    chinchiro_wins: 'チンチロ 勝利',
    dice_sixes: 'Dice 6の目',
  };
  return labels[metric];
}

export function formatArcadeLeaderboard(
  metric: ArcadeMetric,
  records: readonly ArcadeLeaderboardRecord[],
): string {
  const label = arcadeMetricLabel(metric);
  if (records.length === 0) {
    return `**🕹️ Arcade Leaderboard — ${label}**\nまだランキングデータがありません。`;
  }
  const lines = records.map((record, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    const suffix = metric === 'highlow_best_streak' ? '連勝' : '回';
    return `${medal} <@${record.userId}> — **${record.value.toLocaleString()}${suffix}**`;
  });
  return [`**🕹️ Arcade Leaderboard — ${label}**`, ...lines].join('\n').slice(0, 1990);
}

async function executeDice(
  context: MiniGamesV3Context,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await ensureEnabled(context, interaction))) return;
  const sides = clamp(interaction.options.getInteger('sides') ?? 6, 2, 100);
  const count = clamp(interaction.options.getInteger('count') ?? 1, 1, 10);
  const values = rollDice(sides, count);
  const sixes = values.filter((value) => value === 6).length;
  await recordMetric(context.prisma, context.guildId, interaction.user.id, 'minigame_plays', 1);
  await recordMetric(context.prisma, context.guildId, interaction.user.id, 'dice_plays', 1);
  if (sixes > 0) {
    await recordMetric(context.prisma, context.guildId, interaction.user.id, 'dice_sixes', sixes);
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const faces = sides === 6 ? values.map(dieFace).join(' ') : values.map((value) => `🎲${value}`).join(' ');
  await interaction.reply({
    content: [
      `🎲 **Dice — ${count}d${sides}**`,
      faces,
      count > 1 ? `合計: **${total}**` : `結果: **${values[0]}**`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  });
}

async function executeChinchiro(
  context: MiniGamesV3Context,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await ensureEnabled(context, interaction))) return;
  const player = rollChinchiroTurn();
  const dealer = rollChinchiroTurn();
  const outcome = compareChinchiroHands(player.hand, dealer.hand);
  const won = outcome === 'player-win';
  await recordMetric(context.prisma, context.guildId, interaction.user.id, 'minigame_plays', 1);
  await recordMetric(context.prisma, context.guildId, interaction.user.id, 'chinchiro_plays', 1);
  if (won) {
    await recordMetric(context.prisma, context.guildId, interaction.user.id, 'minigame_wins', 1);
    await recordMetric(context.prisma, context.guildId, interaction.user.id, 'chinchiro_wins', 1);
  }
  if (isChinchiroSpecial(player.hand)) {
    await recordMetric(context.prisma, context.guildId, interaction.user.id, 'chinchiro_specials', 1);
  }
  const result =
    outcome === 'player-win'
      ? '🎉 **あなたの勝ち！**'
      : outcome === 'dealer-win'
        ? '😵 **親の勝ち**'
        : '🤝 **あいこ**';
  await interaction.reply({
    content: [
      '🎋 **チンチロ**',
      `あなた: ${formatChinchiroHand(player.hand)} · ${player.rolls}投`,
      `親: ${formatChinchiroHand(dealer.hand)} · ${dealer.rolls}投`,
      '',
      result,
    ].join('\n'),
    allowedMentions: { parse: [] },
  });
}

async function executeArcadeLeaderboard(
  context: MiniGamesV3Context,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await ensureEnabled(context, interaction))) return;
  const config = readConfig(context.config);
  if (!config.leaderboardEnabled) {
    await interaction.reply({ content: 'Arcade Leaderboardは現在無効です。', ephemeral: true });
    return;
  }
  const rawMetric = interaction.options.getString('metric') ?? 'minigame_wins';
  const metric = isArcadeMetric(rawMetric) ? rawMetric : 'minigame_wins';
  const limit = clamp(interaction.options.getInteger('limit') ?? 10, 5, 25);
  const records = await listArcadeLeaderboard(context.prisma, context.guildId, metric, limit);
  await interaction.reply({
    content: formatArcadeLeaderboard(metric, records),
    allowedMentions: { parse: [] },
  });
}

async function ensureEnabled(
  context: MiniGamesV3Context,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'このコマンドはDiscordサーバー内でのみ利用できます。', ephemeral: true });
    return false;
  }
  if (!readConfig(context.config).enabled) {
    await interaction.reply({ content: 'Mini Games Pluginは現在無効です。', ephemeral: true });
    return false;
  }
  return true;
}

async function listArcadeLeaderboard(
  prisma: PrismaClient,
  guildId: string,
  metric: ArcadeMetric,
  limit: number,
): Promise<ArcadeLeaderboardRecord[]> {
  const rows = await prisma.$queryRaw<Array<{ userId: string; value: bigint }>>`
    SELECT
      "user_id"::text AS "userId",
      CASE
        WHEN "metric" = 'highlow_best_streak' THEN MAX("value")
        ELSE SUM("value")
      END::bigint AS "value"
    FROM "community_activity_daily"
    WHERE "guild_id" = ${guildId}
      AND "metric" = ${metric}
    GROUP BY "user_id", "metric"
    HAVING CASE
      WHEN "metric" = 'highlow_best_streak' THEN MAX("value")
      ELSE SUM("value")
    END > 0
    ORDER BY "value" DESC, "userId" ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({ userId: row.userId, value: Math.max(0, Number(row.value)) }));
}

async function recordMetric(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  metric: string,
  amount: number,
): Promise<void> {
  const safeAmount = Math.max(0, Math.trunc(amount));
  if (safeAmount === 0) return;
  const dateKey = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await prisma.$executeRaw`
    INSERT INTO "community_activity_daily" (
      "guild_id", "user_id", "activity_date", "metric", "value"
    ) VALUES (
      ${guildId}, ${userId}, ${dateKey}::date, ${metric}, ${BigInt(safeAmount)}
    )
    ON CONFLICT ("guild_id", "user_id", "activity_date", "metric")
    DO UPDATE SET "value" = "community_activity_daily"."value" + EXCLUDED."value"
  `;
}

function readConfig(value: unknown): { enabled: boolean; leaderboardEnabled: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { enabled: true, leaderboardEnabled: true };
  }
  const source = value as Record<string, unknown>;
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    leaderboardEnabled:
      source.leaderboardEnabled === undefined ? true : source.leaderboardEnabled === true,
  };
}

function isArcadeMetric(value: string): value is ArcadeMetric {
  return (ARCADE_METRICS as readonly string[]).includes(value);
}

function dieFace(value: number): string {
  return ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][value - 1] ?? `🎲${value}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
