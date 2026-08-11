import type { PrismaClient } from '@herta/db';
import { giveawayManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import { randomInt } from 'node:crypto';
import {
  closeExpiredGiveaways,
  closeGiveawayByCreator,
  countActiveGiveaways,
  createGiveaway,
  deleteGiveaway,
  getGiveawaySnapshot,
  listCreatorGiveaways,
  listGiveawayEntrants,
  replaceGiveawayWinners,
  setGiveawayMessageId,
  toggleGiveawayEntry,
  type GiveawayListRecord,
  type GiveawaySnapshot,
} from './giveaway-repository.js';

const EPHEMERAL_FLAG = 64;
const GIVEAWAY_CUSTOM_ID_PREFIX = 'herta:giveaway:v1:';
const WORKER_INTERVAL_MS = 30_000;
const MAX_DURATION_MINUTES = 10_080;
const MAX_PRIZE_LENGTH = 200;
const MAX_WINNERS = 20;
const MAX_LIST_PAGE_LENGTH = 1900;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface GiveawayConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
  defaultWinnerCount: number;
  maxWinnerCount: number;
  allowCreatorEntry: boolean;
  announceWinners: boolean;
  maxActivePerUser: number;
}

export interface GiveawayMessage {
  content: string;
  components: Array<Record<string, unknown>>;
  allowedMentions: { parse: []; users?: string[] };
}

interface GiveawayCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
}

interface GiveawayMessageHandle {
  id: string;
  edit(options: GiveawayMessage): Promise<unknown>;
}

interface GiveawayTextChannel {
  isTextBased(): boolean;
  send(options: GiveawayMessage): Promise<GiveawayMessageHandle>;
  messages: { fetch(messageId: string): Promise<GiveawayMessageHandle> };
}

interface GiveawayClient {
  channels: { fetch(channelId: string): Promise<GiveawayTextChannel | null> };
}

interface GiveawayReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: []; users?: string[] };
}

interface GiveawayCommandInteraction {
  guildId: string | null;
  channelId: string | null;
  channel: GiveawayTextChannel | null;
  user: { id: string };
  options: GiveawayCommandOptions;
  reply(options: GiveawayReplyOptions): Promise<unknown>;
  followUp(options: GiveawayReplyOptions): Promise<unknown>;
}

interface GiveawayComponentInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  isButton?(): boolean;
  reply(options: GiveawayReplyOptions): Promise<unknown>;
  update(options: GiveawayMessage): Promise<unknown>;
}

type GiveawayRuntimeContext = PluginRuntimeContext<GiveawayConfig, GiveawayClient, PrismaClient>;

const workerTimers = new Map<string, NodeJS.Timeout>();
const workerRuns = new Map<string, Promise<void>>();

export const giveawayPlugin = definePlugin<GiveawayConfig, GiveawayClient, PrismaClient>({
  manifest: giveawayManifest,
  async onEnable(context) {
    startGiveawayWorker(context);
  },
  async onDisable(context) {
    stopGiveawayWorker(context.guildId);
  },
  provideCommands(context) {
    const command: CommandHandler<GiveawayCommandInteraction> = {
      definition: giveawayManifest.commands[0]!,
      async execute(interaction) {
        await executeGiveawayCommand(context, interaction);
      },
    };
    return [command];
  },
  provideEvents() {
    return createGiveawayEvents() as PluginEventHandler<GiveawayConfig>[];
  },
});

function createGiveawayEvents(): PluginEventHandler<GiveawayConfig>[] {
  return [
    {
      event: 'interactionCreate',
      async handler(context, ...args) {
        const interaction = args[0] as GiveawayComponentInteraction | undefined;
        await handleGiveawayComponent(context as GiveawayRuntimeContext, interaction);
      },
    },
  ];
}

export function normalizeGiveawayConfig(value: unknown): GiveawayConfig {
  const source = isRecord(value) ? value : {};
  const maxDurationMinutes = clamp(
    toInteger(source.maxDurationMinutes, MAX_DURATION_MINUTES),
    1,
    MAX_DURATION_MINUTES,
  );
  const defaultDurationMinutes = clamp(
    toInteger(source.defaultDurationMinutes, 1440),
    1,
    maxDurationMinutes,
  );
  const maxWinnerCount = clamp(toInteger(source.maxWinnerCount, 10), 1, MAX_WINNERS);
  const defaultWinnerCount = clamp(toInteger(source.defaultWinnerCount, 1), 1, maxWinnerCount);
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? true : source.ephemeralResponses === true,
    defaultDurationMinutes,
    maxDurationMinutes,
    defaultWinnerCount,
    maxWinnerCount,
    allowCreatorEntry:
      source.allowCreatorEntry === undefined ? false : source.allowCreatorEntry === true,
    announceWinners: source.announceWinners === undefined ? true : source.announceWinners === true,
    maxActivePerUser: clamp(toInteger(source.maxActivePerUser, 3), 1, 20),
  };
}

export function buildGiveawayMessage(snapshot: GiveawaySnapshot): GiveawayMessage {
  const closed = snapshot.status === 'closed';
  const unix = Math.floor(snapshot.endsAt.getTime() / 1000);
  const status = closed ? '🔒 終了' : `⏳ <t:${unix}:R>まで`;
  const winnerLine = closed
    ? snapshot.winners.length > 0
      ? snapshot.announceWinners
        ? `🏆 当選: ${snapshot.winners.map((userId) => `<@${userId}>`).join('、')}`
        : `🏆 当選者 ${snapshot.winners.length}名（詳細は \`/giveaway info\`）`
      : '🏆 当選者なし（参加者がいませんでした）'
    : `🏆 当選人数: ${snapshot.winnerCount}名`;
  const content = [
    `🎉 **Giveaway**`,
    `**${snapshot.prize}**`,
    status,
    winnerLine,
    `👥 参加者: ${snapshot.entryCount}人`,
    `Giveaway ID: \`${snapshot.id}\``,
  ].join('\n');
  const components = closed
    ? []
    : [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              custom_id: `${GIVEAWAY_CUSTOM_ID_PREFIX}entry:${snapshot.id}`,
              label: '🎉 参加 / 取消',
            },
          ],
        },
      ];
  return {
    content: truncate(content, 1990),
    components,
    allowedMentions: {
      parse: [],
      ...(closed && snapshot.announceWinners && snapshot.winners.length > 0
        ? { users: snapshot.winners }
        : {}),
    },
  };
}

export function selectRandomWinners(entrants: readonly string[], count: number): string[] {
  const pool = [...new Set(entrants)];
  const limit = Math.min(Math.max(0, count), pool.length);
  for (let index = 0; index < limit; index += 1) {
    const selected = index + randomInt(pool.length - index);
    [pool[index], pool[selected]] = [pool[selected]!, pool[index]!];
  }
  return pool.slice(0, limit);
}

async function executeGiveawayCommand(
  context: GiveawayRuntimeContext,
  interaction: GiveawayCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(context, interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeGiveawayConfig(context.config);
  if (!config.enabled) {
    await reply(context, interaction, 'Giveaway Pluginは現在無効です。');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') return handleCreate(context, config, interaction);
  if (subcommand === 'list') return handleList(context, interaction);
  if (subcommand === 'info') return handleInfo(context, interaction);
  if (subcommand === 'end') return handleEnd(context, interaction);
  if (subcommand === 'reroll') return handleReroll(context, interaction);
  await reply(context, interaction, '不明なGiveaway操作です。');
}

async function handleCreate(
  context: GiveawayRuntimeContext,
  config: GiveawayConfig,
  interaction: GiveawayCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const prize = interaction.options.getString('prize', true)?.trim() ?? '';
  if (!prize || prize.length > MAX_PRIZE_LENGTH) {
    await reply(context, interaction, 'prizeは1〜200文字で入力してください。');
    return;
  }
  if (!interaction.channelId || !interaction.channel?.isTextBased()) {
    await reply(context, interaction, 'このチャンネルにはGiveawayを投稿できません。');
    return;
  }
  const active = await countActiveGiveaways(context.prisma, guildId, interaction.user.id);
  if (active >= config.maxActivePerUser) {
    await reply(
      context,
      interaction,
      `開催中Giveawayが上限（${config.maxActivePerUser}件）に達しています。`,
    );
    return;
  }

  const duration = clamp(
    interaction.options.getInteger('duration') ?? config.defaultDurationMinutes,
    1,
    config.maxDurationMinutes,
  );
  const winnerCount = clamp(
    interaction.options.getInteger('winners') ?? config.defaultWinnerCount,
    1,
    config.maxWinnerCount,
  );
  const endsAt = new Date(Date.now() + duration * 60_000);
  const giveawayId = await createGiveaway(context.prisma, {
    guildId,
    creatorId: interaction.user.id,
    channelId: interaction.channelId,
    prize,
    winnerCount,
    announceWinners: config.announceWinners,
    endsAt,
  });
  try {
    const snapshot = await getGiveawaySnapshot(context.prisma, giveawayId, guildId);
    if (!snapshot) throw new Error('GiveawaySnapshotMissing');
    const message = await interaction.channel.send(buildGiveawayMessage(snapshot));
    await setGiveawayMessageId(context.prisma, giveawayId, message.id);
    await reply(
      context,
      interaction,
      `🎉 Giveawayを作成しました。\nID: \`${giveawayId}\`\n終了: <t:${Math.floor(endsAt.getTime() / 1000)}:F>`,
    );
  } catch (error) {
    await deleteGiveaway(context.prisma, giveawayId).catch(() => undefined);
    context.logger.warn({ err: error, guildId, giveawayId }, 'Giveaway投稿に失敗しました');
    await reply(context, interaction, 'Giveawayの投稿に失敗しました。チャンネル権限を確認してください。');
  }
}

async function handleList(
  context: GiveawayRuntimeContext,
  interaction: GiveawayCommandInteraction,
): Promise<void> {
  const records = await listCreatorGiveaways(
    context.prisma,
    interaction.guildId!,
    interaction.user.id,
  );
  const pages = formatGiveawayListPages(records);
  await reply(context, interaction, pages[0]!);
  for (const page of pages.slice(1)) await followUp(context, interaction, page);
}

async function handleInfo(
  context: GiveawayRuntimeContext,
  interaction: GiveawayCommandInteraction,
): Promise<void> {
  const id = readId(interaction);
  if (!id) return reply(context, interaction, invalidIdMessage());
  const snapshot = await getGiveawaySnapshot(context.prisma, id, interaction.guildId!);
  if (!snapshot) return reply(context, interaction, 'Giveawayが見つかりません。');
  await reply(context, interaction, formatGiveawayInfo(snapshot));
}

async function handleEnd(
  context: GiveawayRuntimeContext,
  interaction: GiveawayCommandInteraction,
): Promise<void> {
  const id = readId(interaction);
  if (!id) return reply(context, interaction, invalidIdMessage());
  const closed = await closeGiveawayByCreator(
    context.prisma,
    id,
    interaction.guildId!,
    interaction.user.id,
  );
  if (!closed) {
    await reply(
      context,
      interaction,
      '開催中Giveawayが見つからないか、あなたが作成したGiveawayではありません。',
    );
    return;
  }
  const snapshot = await drawAndStoreWinners(context.prisma, id, interaction.guildId!);
  if (snapshot) await updateStoredGiveawayMessage(context.client, snapshot);
  await reply(context, interaction, `Giveaway \`${id}\` を終了して抽選しました。`);
}

async function handleReroll(
  context: GiveawayRuntimeContext,
  interaction: GiveawayCommandInteraction,
): Promise<void> {
  const id = readId(interaction);
  if (!id) return reply(context, interaction, invalidIdMessage());
  const current = await getGiveawaySnapshot(context.prisma, id, interaction.guildId!);
  if (!current || current.creatorId !== interaction.user.id || current.status !== 'closed') {
    await reply(
      context,
      interaction,
      '終了済みGiveawayが見つからないか、あなたが作成したGiveawayではありません。',
    );
    return;
  }
  const snapshot = await drawAndStoreWinners(context.prisma, id, interaction.guildId!);
  if (snapshot) await updateStoredGiveawayMessage(context.client, snapshot);
  await reply(context, interaction, `Giveaway \`${id}\` の当選者を再抽選しました。`);
}

async function handleGiveawayComponent(
  context: GiveawayRuntimeContext,
  interaction: GiveawayComponentInteraction | undefined,
): Promise<void> {
  if (!interaction?.isButton?.() || !interaction.customId?.startsWith(GIVEAWAY_CUSTOM_ID_PREFIX))
    return;
  if (!interaction.guildId) return;
  const giveawayId = parseGiveawayCustomId(interaction.customId);
  if (!giveawayId) return;
  const snapshot = await getGiveawaySnapshot(context.prisma, giveawayId, interaction.guildId);
  if (!snapshot) return;
  const config = normalizeGiveawayConfig(context.config);
  if (!config.allowCreatorEntry && snapshot.creatorId === interaction.user.id) {
    await interaction.reply({
      content: 'このサーバー設定ではGiveaway主催者本人は参加できません。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const result = await toggleGiveawayEntry(context.prisma, {
    giveawayId,
    guildId: interaction.guildId,
    userId: interaction.user.id,
  });
  if (!result.accepted) {
    if (result.reason === 'expired') {
      await closeExpiredGiveaways(context.prisma, interaction.guildId);
      const closed = await drawAndStoreWinners(context.prisma, giveawayId, interaction.guildId);
      if (closed) {
        await interaction.update(buildGiveawayMessage(closed));
        return;
      }
    }
    await interaction.reply({
      content: 'このGiveawayは終了しているため参加できません。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const updated = await getGiveawaySnapshot(context.prisma, giveawayId, interaction.guildId);
  if (!updated) return;
  await interaction.update(buildGiveawayMessage(updated));
}

function startGiveawayWorker(context: GiveawayRuntimeContext): void {
  stopGiveawayWorker(context.guildId);
  void runGiveawayCycle(context);
  const timer = setInterval(() => void runGiveawayCycle(context), WORKER_INTERVAL_MS);
  timer.unref();
  workerTimers.set(context.guildId, timer);
}

function stopGiveawayWorker(guildId: string): void {
  const timer = workerTimers.get(guildId);
  if (timer) clearInterval(timer);
  workerTimers.delete(guildId);
}

async function runGiveawayCycle(context: GiveawayRuntimeContext): Promise<void> {
  const existing = workerRuns.get(context.guildId);
  if (existing) return existing;
  const run = processExpiredGiveaways(context)
    .catch((error) => {
      context.logger.warn(
        { err: error, guildId: context.guildId },
        'Giveaway workerの実行に失敗しました',
      );
    })
    .finally(() => {
      if (workerRuns.get(context.guildId) === run) workerRuns.delete(context.guildId);
    });
  workerRuns.set(context.guildId, run);
  return run;
}

async function processExpiredGiveaways(context: GiveawayRuntimeContext): Promise<void> {
  const closedIds = await closeExpiredGiveaways(context.prisma, context.guildId);
  for (const giveawayId of closedIds) {
    const snapshot = await drawAndStoreWinners(context.prisma, giveawayId, context.guildId);
    if (!snapshot) continue;
    await updateStoredGiveawayMessage(context.client, snapshot).catch((error) => {
      context.logger.warn(
        { err: error, guildId: context.guildId, giveawayId },
        '終了したGiveawayメッセージの更新に失敗しました',
      );
    });
  }
}

async function drawAndStoreWinners(
  prisma: PrismaClient,
  giveawayId: string,
  guildId: string,
): Promise<GiveawaySnapshot | null> {
  const snapshot = await getGiveawaySnapshot(prisma, giveawayId, guildId);
  if (!snapshot) return null;
  const entrants = await listGiveawayEntrants(prisma, giveawayId);
  const winnerIds = selectRandomWinners(entrants, snapshot.winnerCount);
  await replaceGiveawayWinners(prisma, giveawayId, winnerIds);
  return getGiveawaySnapshot(prisma, giveawayId, guildId);
}

async function updateStoredGiveawayMessage(
  client: GiveawayClient,
  snapshot: GiveawaySnapshot,
): Promise<void> {
  if (!snapshot.messageId) return;
  const channel = await client.channels.fetch(snapshot.channelId);
  if (!channel?.isTextBased()) throw new Error('GiveawayChannelUnavailable');
  const message = await channel.messages.fetch(snapshot.messageId);
  await message.edit(buildGiveawayMessage(snapshot));
}

export function formatGiveawayListPages(records: readonly GiveawayListRecord[]): string[] {
  if (records.length === 0) return ['開催中または最近終了したGiveawayはありません。'];
  const lines = records.map((record) => {
    const unix = Math.floor(record.endsAt.getTime() / 1000);
    return `\`${record.id}\` · ${record.status === 'open' ? '開催中' : '終了'} · ${record.entryCount}人 · <t:${unix}:R>\n${truncate(record.prize, 100)}`;
  });
  const pages: string[] = [];
  let current = '**あなたのGiveaway一覧**';
  for (const line of lines) {
    const next = `${current}\n\n${line}`;
    if (next.length > MAX_LIST_PAGE_LENGTH) {
      pages.push(current);
      current = `**あなたのGiveaway一覧（続き）**\n\n${line}`;
    } else {
      current = next;
    }
  }
  pages.push(current);
  return pages;
}

export function formatGiveawayInfo(snapshot: GiveawaySnapshot): string {
  const winners = snapshot.winners.length > 0
    ? snapshot.winners.map((id) => `<@${id}>`).join('、')
    : 'なし';
  return [
    `🎉 **${snapshot.prize}**`,
    `状態: ${snapshot.status === 'open' ? '開催中' : '終了'}`,
    `参加者: ${snapshot.entryCount}人`,
    `当選予定: ${snapshot.winnerCount}人`,
    snapshot.status === 'closed' ? `当選者: ${winners}` : null,
    `終了: <t:${Math.floor(snapshot.endsAt.getTime() / 1000)}:F>`,
    `ID: \`${snapshot.id}\``,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function readId(interaction: GiveawayCommandInteraction): string | null {
  const id = interaction.options.getString('id', true)?.trim() ?? '';
  return UUID_PATTERN.test(id) ? id : null;
}

function invalidIdMessage(): string {
  return 'Giveaway IDの形式が正しくありません。`/giveaway list`からコピーしてください。';
}

function parseGiveawayCustomId(customId: string): string | null {
  const body = customId.slice(GIVEAWAY_CUSTOM_ID_PREFIX.length);
  const [action, giveawayId] = body.split(':');
  return action === 'entry' && giveawayId && UUID_PATTERN.test(giveawayId) ? giveawayId : null;
}

async function reply(
  context: GiveawayRuntimeContext,
  interaction: GiveawayCommandInteraction,
  content: string,
): Promise<void> {
  const config = normalizeGiveawayConfig(context.config);
  await interaction.reply({
    content,
    ...(config.ephemeralResponses ? { flags: EPHEMERAL_FLAG } : {}),
    allowedMentions: { parse: [] },
  });
}

async function followUp(
  context: GiveawayRuntimeContext,
  interaction: GiveawayCommandInteraction,
  content: string,
): Promise<void> {
  const config = normalizeGiveawayConfig(context.config);
  await interaction.followUp({
    content,
    ...(config.ephemeralResponses ? { flags: EPHEMERAL_FLAG } : {}),
    allowedMentions: { parse: [] },
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function toInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
