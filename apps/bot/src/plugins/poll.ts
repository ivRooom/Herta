import type { PrismaClient } from '@herta/db';
import { pollManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import {
  closeExpiredPolls,
  closePollByCreator,
  countActivePolls,
  createPoll,
  deletePoll,
  getPollSnapshot,
  listCreatorPolls,
  setPollMessageId,
  votePoll,
  type PollListRecord,
  type PollResultStyle,
  type PollSnapshot,
} from './poll-repository.js';

const EPHEMERAL_FLAG = 64;
const POLL_CUSTOM_ID_PREFIX = 'herta:poll:v1:';
const WORKER_INTERVAL_MS = 30_000;
const MAX_QUESTION_LENGTH = 200;
const MAX_OPTION_LENGTH = 80;
const MAX_OPTIONS = 10;
const MAX_DURATION_MINUTES = 10_080;
const MAX_LIST_PAGE_LENGTH = 1900;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PollConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
  defaultMultipleChoice: boolean;
  showLiveResults: boolean;
  resultStyle: PollResultStyle;
  closeAnnouncement: boolean;
  maxActivePerUser: number;
}

export interface PollMessage {
  content: string;
  components: Array<Record<string, unknown>>;
  allowedMentions: { parse: [] };
}

interface PollCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
  getBoolean(name: string, required?: boolean): boolean | null;
}

interface PollMessageHandle {
  id: string;
  edit(options: PollMessage): Promise<unknown>;
}

interface PollTextChannel {
  isTextBased(): boolean;
  send(options: PollMessage): Promise<PollMessageHandle>;
  messages: {
    fetch(messageId: string): Promise<PollMessageHandle>;
  };
}

interface PollClient {
  channels: {
    fetch(channelId: string): Promise<PollTextChannel | null>;
  };
}

interface PollReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

interface PollCommandInteraction {
  guildId: string | null;
  channelId: string | null;
  channel: PollTextChannel | null;
  user: { id: string };
  options: PollCommandOptions;
  reply(options: PollReplyOptions): Promise<unknown>;
  followUp(options: PollReplyOptions): Promise<unknown>;
}

interface PollComponentInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  isButton?(): boolean;
  reply(options: PollReplyOptions): Promise<unknown>;
  update(options: PollMessage): Promise<unknown>;
}

type PollRuntimeContext = PluginRuntimeContext<PollConfig, PollClient, PrismaClient>;

const workerTimers = new Map<string, NodeJS.Timeout>();
const workerRuns = new Map<string, Promise<void>>();

export const pollPlugin = definePlugin<PollConfig, PollClient, PrismaClient>({
  manifest: pollManifest,
  async onEnable(context) {
    startPollWorker(context);
  },
  async onDisable(context) {
    stopPollWorker(context.guildId);
  },
  provideCommands(context) {
    const command: CommandHandler<PollCommandInteraction> = {
      definition: pollManifest.commands[0]!,
      async execute(interaction) {
        await executePollCommand(context, interaction);
      },
    };
    return [command];
  },
  provideEvents() {
    return createPollEvents() as PluginEventHandler<PollConfig>[];
  },
});

function createPollEvents(): PluginEventHandler<PollConfig>[] {
  return [
    {
      event: 'interactionCreate',
      async handler(context, ...args) {
        const interaction = args[0] as PollComponentInteraction | undefined;
        await handlePollComponent(context as PollRuntimeContext, interaction);
      },
    },
  ];
}

export function normalizePollConfig(value: unknown): PollConfig {
  const source = isRecord(value) ? value : {};
  const requestedMaxDuration = toInteger(source.maxDurationMinutes, MAX_DURATION_MINUTES);
  const maxDurationMinutes = clamp(requestedMaxDuration, 1, MAX_DURATION_MINUTES);
  const requestedDefaultDuration = toInteger(source.defaultDurationMinutes, 60);
  const defaultDurationMinutes = clamp(requestedDefaultDuration, 1, maxDurationMinutes);
  const resultStyle = source.resultStyle === 'count' ? 'count' : 'percentage';
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? true : source.ephemeralResponses === true,
    defaultDurationMinutes,
    maxDurationMinutes,
    defaultMultipleChoice:
      source.defaultMultipleChoice === undefined ? false : source.defaultMultipleChoice === true,
    showLiveResults: source.showLiveResults === undefined ? true : source.showLiveResults === true,
    resultStyle,
    closeAnnouncement:
      source.closeAnnouncement === undefined ? true : source.closeAnnouncement === true,
    maxActivePerUser: clamp(toInteger(source.maxActivePerUser, 5), 1, 20),
  };
}

export function parsePollOptions(input: string): string[] | null {
  const options = input
    .split('|')
    .map((option) => option.trim())
    .filter(Boolean);
  if (options.length < 2 || options.length > MAX_OPTIONS) return null;
  if (options.some((option) => option.length > MAX_OPTION_LENGTH)) return null;
  const normalized = options.map((option) => option.toLocaleLowerCase('ja-JP'));
  if (new Set(normalized).size !== normalized.length) return null;
  return options;
}

export function buildPollMessage(snapshot: PollSnapshot): PollMessage {
  const closed = snapshot.status === 'closed';
  const revealResults = closed || snapshot.showLiveResults;
  const unix = Math.floor(snapshot.endsAt.getTime() / 1000);
  const modeLabel = snapshot.multiple ? '複数選択' : '1つ選択';
  const statusLabel = closed ? '🔒 終了' : `⏳ <t:${unix}:R>まで`;
  const resultLines = snapshot.options.map((option, index) => {
    const prefix = `${index + 1}. ${option.label}`;
    if (!revealResults) return `${prefix} — 投票受付中`;
    if (snapshot.resultStyle === 'count') return `${prefix} — **${option.votes}票**`;
    const denominator = snapshot.totalVotes || 1;
    const percentage = Math.round((option.votes / denominator) * 100);
    return `${prefix} — **${option.votes}票 / ${percentage}%**`;
  });
  const summary = revealResults
    ? `投票者 ${snapshot.uniqueVoters}人 / 合計選択 ${snapshot.totalVotes}票`
    : `投票者 ${snapshot.uniqueVoters}人`;
  const content = [
    `📊 **${snapshot.question}**`,
    `${modeLabel} · ${statusLabel}`,
    '',
    ...resultLines,
    '',
    summary,
    `Poll ID: \`${snapshot.id}\``,
  ].join('\n');

  const components: Array<Record<string, unknown>> = [];
  if (!closed) {
    for (let index = 0; index < snapshot.options.length; index += 5) {
      components.push({
        type: 1,
        components: snapshot.options.slice(index, index + 5).map((option) => ({
          type: 2,
          style: 2,
          custom_id: `${POLL_CUSTOM_ID_PREFIX}vote:${snapshot.id}:${option.position}`,
          label: truncate(`${option.position + 1}. ${option.label}`, 80),
        })),
      });
    }
  }
  return { content: truncate(content, 1990), components, allowedMentions: { parse: [] } };
}

async function executePollCommand(
  context: PollRuntimeContext,
  interaction: PollCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(context, interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizePollConfig(context.config);
  if (!config.enabled) {
    await reply(context, interaction, 'Poll Pluginは現在無効です。');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') {
    await handleCreate(context, config, interaction);
    return;
  }
  if (subcommand === 'list') {
    await handleList(context, interaction);
    return;
  }
  if (subcommand === 'results') {
    await handleResults(context, interaction);
    return;
  }
  if (subcommand === 'close') {
    await handleClose(context, interaction);
    return;
  }
  await reply(context, interaction, '不明なPoll操作です。');
}

async function handleCreate(
  context: PollRuntimeContext,
  config: PollConfig,
  interaction: PollCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const question = interaction.options.getString('question', true)?.trim() ?? '';
  const rawOptions = interaction.options.getString('options', true) ?? '';
  const options = parsePollOptions(rawOptions);
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    await reply(context, interaction, 'questionは1〜200文字で入力してください。');
    return;
  }
  if (!options) {
    await reply(
      context,
      interaction,
      'optionsは `選択肢A | 選択肢B` の形式で2〜10件、各80文字以内・重複なしで入力してください。',
    );
    return;
  }
  if (!interaction.channelId || !interaction.channel?.isTextBased()) {
    await reply(context, interaction, 'このチャンネルにはPollを投稿できません。');
    return;
  }

  const activeCount = await countActivePolls(context.prisma, guildId, interaction.user.id);
  if (activeCount >= config.maxActivePerUser) {
    await reply(
      context,
      interaction,
      `開催中Pollが上限（${config.maxActivePerUser}件）に達しています。既存Pollを終了してください。`,
    );
    return;
  }

  const requestedDuration = interaction.options.getInteger('duration');
  const duration = clamp(
    requestedDuration ?? config.defaultDurationMinutes,
    1,
    config.maxDurationMinutes,
  );
  const multiple = interaction.options.getBoolean('multiple') ?? config.defaultMultipleChoice;
  const endsAt = new Date(Date.now() + duration * 60_000);
  const pollId = await createPoll(context.prisma, {
    guildId,
    creatorId: interaction.user.id,
    channelId: interaction.channelId,
    question,
    options,
    multiple,
    showLiveResults: config.showLiveResults,
    resultStyle: config.resultStyle,
    closeAnnouncement: config.closeAnnouncement,
    endsAt,
  });

  try {
    const snapshot = await getPollSnapshot(context.prisma, pollId, guildId);
    if (!snapshot) throw new Error('PollSnapshotMissing');
    const message = await interaction.channel.send(buildPollMessage(snapshot));
    await setPollMessageId(context.prisma, pollId, message.id);
    await reply(
      context,
      interaction,
      `📊 Pollを作成しました。\nID: \`${pollId}\`\n終了: <t:${Math.floor(endsAt.getTime() / 1000)}:F>`,
    );
  } catch (error) {
    await deletePoll(context.prisma, pollId).catch(() => undefined);
    context.logger.warn({ err: error, guildId, pollId }, 'Pollメッセージの作成に失敗しました');
    await reply(context, interaction, 'Pollの投稿に失敗しました。チャンネル権限を確認してください。');
  }
}

async function handleList(
  context: PollRuntimeContext,
  interaction: PollCommandInteraction,
): Promise<void> {
  const records = await listCreatorPolls(
    context.prisma,
    interaction.guildId!,
    interaction.user.id,
  );
  const pages = formatPollListPages(records);
  await reply(context, interaction, pages[0]!);
  for (const page of pages.slice(1)) await followUp(context, interaction, page);
}

async function handleResults(
  context: PollRuntimeContext,
  interaction: PollCommandInteraction,
): Promise<void> {
  const id = interaction.options.getString('id', true)?.trim() ?? '';
  if (!UUID_PATTERN.test(id)) {
    await reply(context, interaction, 'Poll IDの形式が正しくありません。`/poll list`からコピーしてください。');
    return;
  }
  const snapshot = await getPollSnapshot(context.prisma, id, interaction.guildId!);
  if (!snapshot) {
    await reply(context, interaction, 'Pollが見つかりません。');
    return;
  }
  await reply(context, interaction, formatPollResult(snapshot));
}

async function handleClose(
  context: PollRuntimeContext,
  interaction: PollCommandInteraction,
): Promise<void> {
  const id = interaction.options.getString('id', true)?.trim() ?? '';
  if (!UUID_PATTERN.test(id)) {
    await reply(context, interaction, 'Poll IDの形式が正しくありません。`/poll list`からコピーしてください。');
    return;
  }
  const closed = await closePollByCreator(
    context.prisma,
    id,
    interaction.guildId!,
    interaction.user.id,
  );
  if (!closed) {
    await reply(context, interaction, '開催中のPollが見つからないか、あなたが作成したPollではありません。');
    return;
  }
  const snapshot = await getPollSnapshot(context.prisma, id, interaction.guildId!);
  if (snapshot) await updateStoredPollMessage(context.client, snapshot);
  await reply(context, interaction, `Poll \`${id}\` を終了しました。`);
}

async function handlePollComponent(
  context: PollRuntimeContext,
  interaction: PollComponentInteraction | undefined,
): Promise<void> {
  if (!interaction?.isButton?.() || !interaction.customId?.startsWith(POLL_CUSTOM_ID_PREFIX)) return;
  if (!interaction.guildId) return;
  const parsed = parsePollCustomId(interaction.customId);
  if (!parsed) return;

  const result = await votePoll(context.prisma, {
    pollId: parsed.pollId,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    optionPosition: parsed.optionPosition,
  });
  if (!result.accepted) {
    if (result.reason === 'expired') {
      await closeExpiredPolls(context.prisma, interaction.guildId);
      const expired = await getPollSnapshot(context.prisma, parsed.pollId, interaction.guildId);
      if (expired) {
        await interaction.update(buildPollMessage(expired));
        return;
      }
    }
    await interaction.reply({
      content:
        result.reason === 'closed' || result.reason === 'expired'
          ? 'このPollは終了しています。'
          : 'このPollには投票できません。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const snapshot = await getPollSnapshot(context.prisma, parsed.pollId, interaction.guildId);
  if (!snapshot) {
    await interaction.reply({
      content: 'Pollの更新に失敗しました。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  await interaction.update(buildPollMessage(snapshot));
}

function startPollWorker(context: PollRuntimeContext): void {
  stopPollWorker(context.guildId);
  void runPollCycle(context);
  const timer = setInterval(() => void runPollCycle(context), WORKER_INTERVAL_MS);
  timer.unref();
  workerTimers.set(context.guildId, timer);
}

function stopPollWorker(guildId: string): void {
  const timer = workerTimers.get(guildId);
  if (timer) clearInterval(timer);
  workerTimers.delete(guildId);
}

async function runPollCycle(context: PollRuntimeContext): Promise<void> {
  const existing = workerRuns.get(context.guildId);
  if (existing) return existing;
  const run = processExpiredPolls(context)
    .catch((error) => {
      context.logger.warn({ err: error, guildId: context.guildId }, 'Poll workerの実行に失敗しました');
    })
    .finally(() => {
      if (workerRuns.get(context.guildId) === run) workerRuns.delete(context.guildId);
    });
  workerRuns.set(context.guildId, run);
  return run;
}

async function processExpiredPolls(context: PollRuntimeContext): Promise<void> {
  const closedIds = await closeExpiredPolls(context.prisma, context.guildId);
  for (const pollId of closedIds) {
    const snapshot = await getPollSnapshot(context.prisma, pollId, context.guildId);
    if (!snapshot || !snapshot.closeAnnouncement) continue;
    await updateStoredPollMessage(context.client, snapshot).catch((error) => {
      context.logger.warn(
        { err: error, guildId: context.guildId, pollId },
        '終了したPollメッセージの更新に失敗しました',
      );
    });
  }
}

async function updateStoredPollMessage(client: PollClient, snapshot: PollSnapshot): Promise<void> {
  if (!snapshot.messageId) return;
  const channel = await client.channels.fetch(snapshot.channelId);
  if (!channel?.isTextBased()) throw new Error('PollChannelUnavailable');
  const message = await channel.messages.fetch(snapshot.messageId);
  await message.edit(buildPollMessage(snapshot));
}

export function formatPollListPages(records: readonly PollListRecord[]): string[] {
  if (records.length === 0) return ['開催中または最近終了したPollはありません。'];
  const lines = records.map((record) => {
    const unix = Math.floor(record.endsAt.getTime() / 1000);
    return `\`${record.id}\` · ${record.status === 'open' ? '開催中' : '終了'} · <t:${unix}:R>\n${truncate(record.question, 100)}`;
  });
  const pages: string[] = [];
  let current = '**あなたのPoll一覧**';
  for (const line of lines) {
    const next = `${current}\n\n${line}`;
    if (next.length > MAX_LIST_PAGE_LENGTH) {
      pages.push(current);
      current = `**あなたのPoll一覧（続き）**\n\n${line}`;
    } else {
      current = next;
    }
  }
  pages.push(current);
  return pages;
}

export function formatPollResult(snapshot: PollSnapshot): string {
  const total = snapshot.totalVotes || 1;
  const lines = snapshot.options.map((option, index) => {
    const percentage = Math.round((option.votes / total) * 100);
    return `${index + 1}. ${option.label} — ${option.votes}票 (${percentage}%)`;
  });
  return [
    `📊 **${snapshot.question}**`,
    snapshot.status === 'closed' ? '状態: 終了' : '状態: 開催中',
    '',
    ...lines,
    '',
    `投票者 ${snapshot.uniqueVoters}人 / 合計選択 ${snapshot.totalVotes}票`,
  ].join('\n');
}

function parsePollCustomId(
  customId: string,
): { pollId: string; optionPosition: number } | null {
  const body = customId.slice(POLL_CUSTOM_ID_PREFIX.length);
  const [action, pollId, positionText] = body.split(':');
  if (action !== 'vote' || !pollId || !UUID_PATTERN.test(pollId)) return null;
  const optionPosition = Number.parseInt(positionText ?? '', 10);
  if (!Number.isInteger(optionPosition) || optionPosition < 0 || optionPosition >= MAX_OPTIONS) {
    return null;
  }
  return { pollId, optionPosition };
}

async function reply(
  context: PollRuntimeContext,
  interaction: PollCommandInteraction,
  content: string,
): Promise<void> {
  const config = normalizePollConfig(context.config);
  await interaction.reply({
    content,
    ...(config.ephemeralResponses ? { flags: EPHEMERAL_FLAG } : {}),
    allowedMentions: { parse: [] },
  });
}

async function followUp(
  context: PollRuntimeContext,
  interaction: PollCommandInteraction,
  content: string,
): Promise<void> {
  const config = normalizePollConfig(context.config);
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
