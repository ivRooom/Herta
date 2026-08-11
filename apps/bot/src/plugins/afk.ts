import type { PrismaClient } from '@herta/db';
import { afkManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import {
  clearAfkStatus,
  getAfkStatus,
  listGuildAfkStatuses,
  setAfkStatus,
  type AfkStatusRecord,
} from './afk-repository.js';

const EPHEMERAL_FLAG = 64;
const MAX_REASON_LENGTH = 200;
const MAX_LIST_PAGE_LENGTH = 1900;
const noticeCooldowns = new Map<string, number>();

export interface AfkConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  defaultReason: string;
  maxReasonLength: number;
  autoClearOnMessage: boolean;
  notifyOnMention: boolean;
  notificationCooldownSeconds: number;
  maxMentionNotices: number;
  maxListEntries: number;
}

interface AfkCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
}

interface AfkCommandInteraction {
  guildId: string | null;
  user: { id: string };
  options: AfkCommandOptions;
  reply(options: ReplyOptions): Promise<unknown>;
  followUp(options: ReplyOptions): Promise<unknown>;
}

interface AfkMentionUser {
  id: string;
  bot?: boolean;
}

interface AfkMessage {
  guildId: string | null;
  channelId: string;
  author: { id: string; bot?: boolean };
  mentions: { users: { values(): IterableIterator<AfkMentionUser> } };
  reply(options: { content: string; allowedMentions: { parse: [] } }): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

type AfkRuntimeContext = PluginRuntimeContext<AfkConfig, unknown, PrismaClient>;

export const afkPlugin = definePlugin<AfkConfig, unknown, PrismaClient>({
  manifest: afkManifest,
  provideCommands(context) {
    const command: CommandHandler<AfkCommandInteraction> = {
      definition: afkManifest.commands[0]!,
      async execute(interaction) {
        await executeAfkCommand(context, interaction);
      },
    };
    return [command];
  },
  provideEvents() {
    return [
      {
        event: 'messageCreate',
        async handler(context, ...args) {
          await handleAfkMessage(context as AfkRuntimeContext, args[0] as AfkMessage | undefined);
        },
      },
    ] as PluginEventHandler<AfkConfig>[];
  },
});

export function normalizeAfkConfig(value: unknown): AfkConfig {
  const source = isRecord(value) ? value : {};
  const maxReasonLength = clamp(toInteger(source.maxReasonLength, 200), 20, 200);
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? true : source.ephemeralResponses === true,
    defaultReason: normalizeReason(source.defaultReason, '離席中', maxReasonLength),
    maxReasonLength,
    autoClearOnMessage:
      source.autoClearOnMessage === undefined ? true : source.autoClearOnMessage === true,
    notifyOnMention: source.notifyOnMention === undefined ? true : source.notifyOnMention === true,
    notificationCooldownSeconds: clamp(toInteger(source.notificationCooldownSeconds, 15), 0, 300),
    maxMentionNotices: clamp(toInteger(source.maxMentionNotices, 5), 1, 10),
    maxListEntries: clamp(toInteger(source.maxListEntries, 25), 5, 50),
  };
}

export function buildAfkNotice(records: readonly AfkStatusRecord[]): string {
  if (records.length === 0) return '';
  const lines = records.map((record) => {
    const unix = Math.floor(record.startedAt.getTime() / 1000);
    return `💤 <@${record.userId}> はAFKです: ${record.reason} · <t:${unix}:R>`;
  });
  return lines.join('\n');
}

export function formatAfkListPages(records: readonly AfkStatusRecord[]): string[] {
  if (records.length === 0) return ['現在AFK中のメンバーはいません。'];
  const pages: string[] = [];
  let current = '**AFKメンバー一覧**';
  for (const record of records) {
    const unix = Math.floor(record.startedAt.getTime() / 1000);
    const line = `<@${record.userId}> · ${record.reason} · <t:${unix}:R>`;
    const next = `${current}\n${line}`;
    if (next.length > MAX_LIST_PAGE_LENGTH) {
      pages.push(current);
      current = `**AFKメンバー一覧（続き）**\n${line}`;
    } else {
      current = next;
    }
  }
  pages.push(current);
  return pages;
}

async function executeAfkCommand(
  context: AfkRuntimeContext,
  interaction: AfkCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(interaction, true, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeAfkConfig(context.config);
  if (!config.enabled) {
    await reply(interaction, true, 'AFK Pluginは現在無効です。');
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'set') return handleSet(context, config, interaction);
  if (subcommand === 'clear') return handleClear(context, config, interaction);
  if (subcommand === 'list') return handleList(context, config, interaction);
  await reply(interaction, config.ephemeralResponses, '不明なAFK操作です。');
}

async function handleSet(
  context: AfkRuntimeContext,
  config: AfkConfig,
  interaction: AfkCommandInteraction,
): Promise<void> {
  const provided = interaction.options.getString('reason')?.trim();
  const reason = normalizeReason(provided, config.defaultReason, config.maxReasonLength);
  if (provided && provided.length > config.maxReasonLength) {
    await reply(
      interaction,
      config.ephemeralResponses,
      `AFK理由は${config.maxReasonLength}文字以内で入力してください。`,
    );
    return;
  }
  const record = await setAfkStatus(context.prisma, {
    guildId: interaction.guildId!,
    userId: interaction.user.id,
    reason,
  });
  const unix = Math.floor(record.startedAt.getTime() / 1000);
  await reply(
    interaction,
    config.ephemeralResponses,
    `💤 AFKを設定しました: ${record.reason}\n開始: <t:${unix}:R>`,
  );
}

async function handleClear(
  context: AfkRuntimeContext,
  config: AfkConfig,
  interaction: AfkCommandInteraction,
): Promise<void> {
  const cleared = await clearAfkStatus(context.prisma, interaction.guildId!, interaction.user.id);
  await reply(
    interaction,
    config.ephemeralResponses,
    cleared ? '👋 AFKを解除しました。' : '現在AFKには設定されていません。',
  );
}

async function handleList(
  context: AfkRuntimeContext,
  config: AfkConfig,
  interaction: AfkCommandInteraction,
): Promise<void> {
  const records = await listGuildAfkStatuses(
    context.prisma,
    interaction.guildId!,
    config.maxListEntries,
  );
  const pages = formatAfkListPages(records);
  await reply(interaction, config.ephemeralResponses, pages[0]!);
  for (const page of pages.slice(1)) {
    await interaction.followUp({
      content: page,
      ...(config.ephemeralResponses ? { flags: EPHEMERAL_FLAG } : {}),
      allowedMentions: { parse: [] },
    });
  }
}

async function handleAfkMessage(
  context: AfkRuntimeContext,
  message: AfkMessage | undefined,
): Promise<void> {
  if (!message?.guildId || message.author.bot) return;
  const config = normalizeAfkConfig(context.config);
  if (!config.enabled) return;

  if (config.autoClearOnMessage) {
    const cleared = await clearAfkStatus(context.prisma, message.guildId, message.author.id);
    if (cleared) {
      await message
        .reply({
          content: '👋 おかえりなさい。AFKを自動解除しました。',
          allowedMentions: { parse: [] },
        })
        .catch((error) =>
          context.logger.warn(
            { err: error, guildId: message.guildId, userId: message.author.id },
            'AFK自動解除メッセージの送信に失敗しました',
          ),
        );
    }
  }

  if (!config.notifyOnMention) return;
  const mentionedUsers = [...message.mentions.users.values()]
    .filter((user) => !user.bot && user.id !== message.author.id)
    .slice(0, config.maxMentionNotices);
  if (mentionedUsers.length === 0) return;

  const now = Date.now();
  const records: AfkStatusRecord[] = [];
  for (const user of mentionedUsers) {
    const key = `${message.guildId}:${message.channelId}:${user.id}`;
    const last = noticeCooldowns.get(key) ?? 0;
    if (
      config.notificationCooldownSeconds > 0 &&
      now - last < config.notificationCooldownSeconds * 1000
    ) {
      continue;
    }
    const record = await getAfkStatus(context.prisma, message.guildId, user.id);
    if (!record) continue;
    records.push(record);
    noticeCooldowns.set(key, now);
  }
  const notice = buildAfkNotice(records);
  if (!notice) return;
  await message
    .reply({ content: notice, allowedMentions: { parse: [] } })
    .catch((error) =>
      context.logger.warn(
        { err: error, guildId: message.guildId, channelId: message.channelId },
        'AFKメンション通知の送信に失敗しました',
      ),
    );
}

async function reply(
  interaction: AfkCommandInteraction,
  ephemeral: boolean,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
    allowedMentions: { parse: [] },
  });
}

function normalizeReason(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const normalized = text || fallback || '離席中';
  return normalized.slice(0, maxLength);
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
