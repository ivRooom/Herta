import type { PrismaClient } from '@herta/db';
import { reminderManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  cancelReminder,
  claimReminder,
  completeReminder,
  countActiveReminders,
  createReminder,
  failReminder,
  listDueReminders,
  listUserReminders,
  recoverStaleReminders,
  type ReminderDelivery,
  type ReminderRecord,
} from './reminder-repository.js';

const EPHEMERAL_FLAG = 64;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_MINUTES = 10_080;
const WORKER_INTERVAL_MS = 30_000;
const STALE_PROCESSING_MS = 10 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const MAX_LIST_LENGTH = 1900;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ReminderConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  maxActivePerUser: number;
}

interface ReminderCommandOptions {
  getSubcommand(): string;
  getInteger(name: string, required?: boolean): number | null;
  getString(name: string, required?: boolean): string | null;
}

interface ReminderCommandInteraction {
  guildId: string | null;
  channelId: string | null;
  user: { id: string };
  options: ReminderCommandOptions;
  reply(options: {
    content: string;
    flags?: number;
    allowedMentions: { parse: [] };
  }): Promise<unknown>;
}

interface ReminderChannel {
  isTextBased(): boolean;
  send(options: {
    content: string;
    allowedMentions: { parse: []; users: string[] };
  }): Promise<unknown>;
}

interface ReminderUser {
  send(options: { content: string; allowedMentions: { parse: [] } }): Promise<unknown>;
}

interface ReminderClient {
  channels: { fetch(channelId: string): Promise<ReminderChannel | null> };
  users: { fetch(userId: string): Promise<ReminderUser> };
}

type ReminderRuntimeContext = PluginRuntimeContext<ReminderConfig, ReminderClient, PrismaClient>;

const workerTimers = new Map<string, NodeJS.Timeout>();
const workerRuns = new Map<string, Promise<void>>();

export const reminderPlugin = definePlugin<ReminderConfig, ReminderClient, PrismaClient>({
  manifest: reminderManifest,
  async onEnable(context) {
    startReminderWorker(context);
  },
  async onDisable(context) {
    stopReminderWorker(context.guildId);
  },
  provideCommands(context) {
    const command: CommandHandler<ReminderCommandInteraction> = {
      definition: reminderManifest.commands[0]!,
      async execute(interaction) {
        await executeReminderCommand(context, interaction);
      },
    };
    return [command];
  },
});

export function normalizeReminderConfig(value: unknown): ReminderConfig {
  const source = isRecord(value) ? value : {};
  const requestedMax = Number(source.maxActivePerUser);
  const maxActivePerUser = Number.isInteger(requestedMax)
    ? Math.max(1, Math.min(50, requestedMax))
    : 20;
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? true : source.ephemeralResponses === true,
    maxActivePerUser,
  };
}

export function formatReminderList(reminders: readonly ReminderRecord[]): string {
  if (reminders.length === 0) return '未配信のリマインダーはありません。';

  const lines = reminders.map((reminder) => {
    const unix = Math.floor(reminder.remindAt.getTime() / 1000);
    const preview = reminder.message.replace(/\s+/g, ' ').slice(0, 80);
    const target = reminder.delivery === 'dm' ? 'DM' : 'チャンネル';
    return `\`${reminder.id}\`\n<t:${unix}:F> (${target}) — ${preview}`;
  });

  const pages: string[] = [];
  let current = '**未配信Reminder一覧**';
  for (const line of lines) {
    const next = `${current}\n\n${line}`;
    if (next.length > MAX_LIST_LENGTH) {
      pages.push(current);
      current = `**未配信Reminder一覧（続き）**\n\n${line}`;
    } else {
      current = next;
    }
  }
  pages.push(current);
  return pages.join('\n\n---\n\n');
}

async function executeReminderCommand(
  context: ReminderRuntimeContext,
  interaction: ReminderCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(context, interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }

  const config = normalizeReminderConfig(context.config);
  if (!config.enabled) {
    await reply(context, interaction, 'Reminder Pluginは現在無効です。');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'set') {
    await handleSet(context, config, interaction);
    return;
  }
  if (subcommand === 'list') {
    const reminders = await listUserReminders(
      context.prisma,
      interaction.guildId,
      interaction.user.id,
    );
    await reply(context, interaction, formatReminderList(reminders));
    return;
  }
  if (subcommand === 'cancel') {
    await handleCancel(context, interaction);
    return;
  }

  await reply(context, interaction, '不明なReminder操作です。');
}

async function handleSet(
  context: ReminderRuntimeContext,
  config: ReminderConfig,
  interaction: ReminderCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const minutes = interaction.options.getInteger('minutes', true) ?? 0;
  const message = interaction.options.getString('message', true)?.trim() ?? '';
  const deliveryInput = interaction.options.getString('delivery') ?? 'channel';

  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    await reply(context, interaction, 'minutesは1〜10080の範囲で指定してください。');
    return;
  }
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    await reply(context, interaction, 'messageは1〜1000文字で入力してください。');
    return;
  }
  if (deliveryInput !== 'channel' && deliveryInput !== 'dm') {
    await reply(context, interaction, 'deliveryはチャンネルまたはDMを指定してください。');
    return;
  }

  const activeCount = await countActiveReminders(context.prisma, guildId, interaction.user.id);
  if (activeCount >= config.maxActivePerUser) {
    await reply(
      context,
      interaction,
      `未配信Reminderが上限（${config.maxActivePerUser}件）に達しています。不要なReminderをキャンセルしてください。`,
    );
    return;
  }

  const delivery = deliveryInput as ReminderDelivery;
  if (delivery === 'channel' && !interaction.channelId) {
    await reply(context, interaction, '現在のチャンネルを取得できないため、DMを選択してください。');
    return;
  }

  const remindAt = new Date(Date.now() + minutes * 60_000);
  const id = await createReminder(context.prisma, {
    guildId,
    userId: interaction.user.id,
    channelId: delivery === 'channel' ? interaction.channelId : null,
    delivery,
    message,
    remindAt,
  });
  const unix = Math.floor(remindAt.getTime() / 1000);
  await reply(
    context,
    interaction,
    `⏰ Reminderを作成しました。\nID: \`${id}\`\n通知: <t:${unix}:F> (<t:${unix}:R>)\n配信先: ${delivery === 'dm' ? 'DM' : '現在のチャンネル'}`,
  );
}

async function handleCancel(
  context: ReminderRuntimeContext,
  interaction: ReminderCommandInteraction,
): Promise<void> {
  const id = interaction.options.getString('id', true)?.trim() ?? '';
  if (!UUID_PATTERN.test(id)) {
    await reply(
      context,
      interaction,
      'Reminder IDの形式が正しくありません。`/remind list`からコピーしてください。',
    );
    return;
  }

  const cancelled = await cancelReminder(
    context.prisma,
    interaction.guildId!,
    interaction.user.id,
    id,
  );
  await reply(
    context,
    interaction,
    cancelled
      ? `Reminder \`${id}\` をキャンセルしました。`
      : '対象Reminderが見つからないか、すでに配信処理中・完了済みです。',
  );
}

function startReminderWorker(context: ReminderRuntimeContext): void {
  stopReminderWorker(context.guildId);
  void runReminderCycle(context);
  const timer = setInterval(() => {
    void runReminderCycle(context);
  }, WORKER_INTERVAL_MS);
  timer.unref();
  workerTimers.set(context.guildId, timer);
}

function stopReminderWorker(guildId: string): void {
  const timer = workerTimers.get(guildId);
  if (timer) clearInterval(timer);
  workerTimers.delete(guildId);
}

async function runReminderCycle(context: ReminderRuntimeContext): Promise<void> {
  const existing = workerRuns.get(context.guildId);
  if (existing) return existing;

  const run = processDueReminders(context)
    .catch((error) => {
      context.logger.warn(
        { err: error, guildId: context.guildId },
        'Reminder workerの実行に失敗しました',
      );
    })
    .finally(() => {
      if (workerRuns.get(context.guildId) === run) workerRuns.delete(context.guildId);
    });
  workerRuns.set(context.guildId, run);
  return run;
}

async function processDueReminders(context: ReminderRuntimeContext): Promise<void> {
  const now = new Date();
  await recoverStaleReminders(
    context.prisma,
    context.guildId,
    new Date(now.getTime() - STALE_PROCESSING_MS),
  );
  const reminders = await listDueReminders(context.prisma, context.guildId, now);
  for (const reminder of reminders) {
    if (!(await claimReminder(context.prisma, reminder.id))) continue;
    try {
      await deliverReminder(context.client, reminder);
      await completeReminder(context.prisma, reminder.id);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'ReminderDeliveryError';
      await failReminder(
        context.prisma,
        reminder.id,
        errorName,
        new Date(Date.now() + RETRY_DELAY_MS),
      );
      context.logger.warn(
        {
          err: error,
          guildId: context.guildId,
          reminderId: reminder.id,
          delivery: reminder.delivery,
        },
        'Reminderの配信に失敗しました',
      );
    }
  }
}

async function deliverReminder(client: ReminderClient, reminder: ReminderRecord): Promise<void> {
  if (reminder.delivery === 'dm') {
    const user = await client.users.fetch(reminder.userId);
    await user.send({
      content: `⏰ **リマインダー**\n${reminder.message}`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!reminder.channelId) throw new Error('ReminderChannelMissing');
  const channel = await client.channels.fetch(reminder.channelId);
  if (!channel?.isTextBased()) throw new Error('ReminderChannelUnavailable');
  await channel.send({
    content: `⏰ <@${reminder.userId}> **リマインダー**\n${reminder.message}`,
    allowedMentions: { parse: [], users: [reminder.userId] },
  });
}

async function reply(
  context: ReminderRuntimeContext,
  interaction: ReminderCommandInteraction,
  content: string,
): Promise<void> {
  const config = normalizeReminderConfig(context.config);
  await interaction.reply({
    content,
    ...(config.ephemeralResponses ? { flags: EPHEMERAL_FLAG } : {}),
    allowedMentions: { parse: [] },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
