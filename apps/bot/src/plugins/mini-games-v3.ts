import type { ChatInputCommandInteraction } from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { miniGamesManifest } from '@herta/plugin-catalog';
import type { CommandHandler } from '@herta/plugin-sdk';
import { createAmidakujiCommandHandler } from './mini-games-amidakuji.js';
import { publishMiniGameCompletion } from './mini-games-completion-events.js';
import { incrementMiniGameMetrics, type MiniGameMetric } from './mini-games-repository.js';
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
  logger?: { warn(input: unknown, message?: string): void };
};

export interface ArcadeLeaderboardRecord {
  userId: string;
  value: number;
}

export function createMiniGamesV3CommandHandlers(
  context: MiniGamesV3Context,
): CommandHandler<ChatInputCommandInteraction>[] {
  return [
    {
      definition: miniGamesManifest.commands[4]!,
      execute: (interaction) => executeDice(context, interaction),
    },
    {
      definition: miniGamesManifest.commands[5]!,
      execute: (interaction) => executeChinchiro(context, interaction),
    },
    {
      definition: miniGamesManifest.commands[6]!,
      execute: (interaction) => executeArcadeLeaderboard(context, interaction),
    },
    createAmidakujiCommandHandler(miniGamesManifest.commands[7]!, () => {
      const config = readConfig(context.config);
      return {
        enabled: config.enabled,
        sessionTimeoutSeconds: readSessionTimeout(context.config),
        complexity: readEnum(context.config, 'amidakujiComplexity', ['simple', 'standard', 'chaos'], 'standard'),
        theme: readEnum(context.config, 'amidakujiTheme', ['arcade', 'midnight', 'classic'], 'arcade'),
        hiddenPercent: readInteger(context.config, 'amidakujiHiddenPercent', 42, 20, 70),
        revealAnimation: readBoolean(context.config, 'amidakujiRevealAnimation', true),
        revealDelayMs: readInteger(context.config, 'amidakujiRevealDelayMs', 700, 250, 2000),
        highlightPaths: readBoolean(context.config, 'amidakujiHighlightPaths', true),
      };
    }),
  ];
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
  const config = readConfig(context.config);
  const sides = clamp(interaction.options.getInteger('sides') ?? 6, 2, 100);
  const count = clamp(interaction.options.getInteger('count') ?? 1, 1, 10);
  const values = rollDice(sides, count);
  const sixes = values.filter((value) => value === 6).length;
  const total = values.reduce((sum, value) => sum + value, 0);
  const faces =
    sides === 6 ? values.map(dieFace).join(' ') : values.map((value) => `🎲${value}`).join(' ');

  await interaction.reply({
    content: [
      `🎲 **Dice — ${count}d${sides}**`,
      faces,
      count > 1 ? `合計: **${total}**` : `結果: **${values[0]}**`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  });

  if (!config.statsEnabled) return;
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['dice_plays', 1],
      ...(sixes > 0 ? ([['dice_sixes', sixes]] as const) : []),
    ],
    interaction.user.id,
  );
  await publishMiniGameCompletion(interaction);
}

async function executeChinchiro(
  context: MiniGamesV3Context,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await ensureEnabled(context, interaction))) return;
  const config = readConfig(context.config);
  const player = rollChinchiroTurn();
  const dealer = rollChinchiroTurn();
  const outcome = compareChinchiroHands(player.hand, dealer.hand);
  const won = outcome === 'player-win';
  const result = won
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

  if (!config.statsEnabled) return;
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['chinchiro_plays', 1],
      ...(won
        ? ([
            ['minigame_wins', 1],
            ['chinchiro_wins', 1],
          ] as const)
        : []),
      ...(isChinchiroSpecial(player.hand) ? ([['chinchiro_specials', 1]] as const) : []),
    ],
    interaction.user.id,
  );
  await publishMiniGameCompletion(interaction);
}

async function executeArcadeLeaderboard(
  context: MiniGamesV3Context,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await ensureEnabled(context, interaction))) return;
  if (!readConfig(context.config).leaderboardEnabled) {
    await interaction.reply({ content: 'Arcade Leaderboardは現在無効です。', ephemeral: true });
    return;
  }
  const rawMetric = interaction.options.getString('metric') ?? 'minigame_wins';
  const metric = isArcadeMetric(rawMetric) ? rawMetric : 'minigame_wins';
  const limit = clamp(interaction.options.getInteger('limit') ?? 10, 5, 25);
  await interaction.deferReply();
  const records = await listArcadeLeaderboard(context.prisma, context.guildId, metric, limit);
  await interaction.editReply({
    content: formatArcadeLeaderboard(metric, records),
    allowedMentions: { parse: [] },
  });
}

export async function listArcadeLeaderboard(
  prisma: PrismaClient,
  guildId: string,
  metric: ArcadeMetric,
  limit: number,
): Promise<ArcadeLeaderboardRecord[]> {
  const safeLimit = clamp(limit, 5, 25);
  const rows = await prisma.$queryRaw<Array<{ userId: string; value: bigint }>>`
    WITH arcade AS (
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
    )
    SELECT "userId", "value"
    FROM arcade
    WHERE "value" > 0
    ORDER BY "value" DESC, "userId" ASC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({ userId: row.userId, value: Math.max(0, Number(row.value)) }));
}

async function ensureEnabled(
  context: MiniGamesV3Context,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'このコマンドはDiscordサーバー内でのみ利用できます。',
      ephemeral: true,
    });
    return false;
  }
  if (!readConfig(context.config).enabled) {
    await interaction.reply({ content: 'Mini Games Pluginは現在無効です。', ephemeral: true });
    return false;
  }
  return true;
}

async function recordMetricsSafely(
  context: MiniGamesV3Context,
  metrics: readonly (readonly [MiniGameMetric, number])[],
  userId: string,
): Promise<void> {
  try {
    await incrementMiniGameMetrics(context.prisma, context.guildId, userId, metrics);
  } catch (error) {
    context.logger?.warn(
      { err: error, guildId: context.guildId, userId },
      'Mini Games v3戦績の保存に失敗しました',
    );
  }
}

function readConfig(value: unknown): {
  enabled: boolean;
  statsEnabled: boolean;
  leaderboardEnabled: boolean;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { enabled: true, statsEnabled: true, leaderboardEnabled: true };
  }
  const source = value as Record<string, unknown>;
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    statsEnabled: source.statsEnabled === undefined ? true : source.statsEnabled === true,
    leaderboardEnabled:
      source.leaderboardEnabled === undefined ? true : source.leaderboardEnabled === true,
  };
}

function readSessionTimeout(value: unknown): number {
  return readInteger(value, 'sessionTimeoutSeconds', 90, 30, 300);
}

function readBoolean(value: unknown, key: string, fallback: boolean): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const raw = (value as Record<string, unknown>)[key];
  return raw === undefined ? fallback : raw === true;
}

function readInteger(value: unknown, key: string, fallback: number, min: number, max: number): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, min, max) : fallback;
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  key: string,
  values: T,
  fallback: T[number],
): T[number] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' && values.includes(raw) ? (raw as T[number]) : fallback;
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