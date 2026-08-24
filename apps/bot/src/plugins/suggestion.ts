import type { PrismaClient } from '@herta/db';
import { suggestionManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import {
  createSuggestion,
  deleteSuggestion,
  getSuggestionSnapshot,
  listAuthorSuggestions,
  setSuggestionMessageId,
  updateSuggestionStatus,
  voteSuggestion,
  type SuggestionListRecord,
  type SuggestionSnapshot,
  type SuggestionStatus,
} from './suggestion-repository.js';

const EPHEMERAL_FLAG = 64;
const CUSTOM_ID_PREFIX = 'herta:suggestion:v1:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONTENT_LENGTH = 1000;
const MAX_NOTE_LENGTH = 300;
const MAX_LIST_PAGE_LENGTH = 1900;
const MAX_INFO_LENGTH = 1900;

export interface SuggestionConfig {
  enabled: boolean;
  suggestionChannelId: string | null;
  anonymousSubmissions: boolean;
  enableVoting: boolean;
  maxOpenPerUser: number;
  staffRoleIds: string[];
  notifyAuthorOnStatusChange: boolean;
}

interface SuggestionOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
}

interface TextMessage {
  id: string;
  edit(options: SuggestionMessage): Promise<unknown>;
}

interface TextChannel {
  isTextBased(): boolean;
  send(options: SuggestionMessage): Promise<TextMessage>;
  messages: { fetch(id: string): Promise<TextMessage> };
}

interface SuggestionClient {
  channels: { fetch(id: string): Promise<TextChannel | null> };
  users: {
    fetch(id: string): Promise<{
      send(options: { content: string; allowedMentions: { parse: [] } }): Promise<unknown>;
    }>;
  };
}

interface CommandInteraction {
  guildId: string | null;
  channelId: string | null;
  channel: TextChannel | null;
  user: { id: string };
  memberPermissions?: { has(permission: string): boolean } | null;
  member?: { roles?: { cache?: { has(id: string): boolean } } } | null;
  options: SuggestionOptions;
  reply(options: ReplyOptions): Promise<unknown>;
  followUp(options: ReplyOptions): Promise<unknown>;
}

interface ComponentInteraction {
  guildId: string | null;
  customId?: string;
  user: { id: string };
  isButton?(): boolean;
  reply(options: ReplyOptions): Promise<unknown>;
  update(options: SuggestionMessage): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

export interface SuggestionMessage {
  content: string;
  components: Array<Record<string, unknown>>;
  allowedMentions: { parse: []; users?: string[] };
}

type SuggestionContext = PluginRuntimeContext<SuggestionConfig, SuggestionClient, PrismaClient>;

export const suggestionPlugin = definePlugin<SuggestionConfig, SuggestionClient, PrismaClient>({
  manifest: suggestionManifest,
  provideCommands(context) {
    const command: CommandHandler<CommandInteraction> = {
      definition: suggestionManifest.commands[0]!,
      async execute(interaction) {
        await executeSuggestionCommand(context, interaction);
      },
    };
    return [command];
  },
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          await handleSuggestionComponent(
            context as SuggestionContext,
            args[0] as ComponentInteraction | undefined,
          );
        },
      },
    ] as PluginEventHandler<SuggestionConfig>[];
  },
});

export function normalizeSuggestionConfig(value: unknown): SuggestionConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    suggestionChannelId:
      typeof source.suggestionChannelId === 'string' && /^\d+$/.test(source.suggestionChannelId)
        ? source.suggestionChannelId
        : null,
    anonymousSubmissions: source.anonymousSubmissions === true,
    enableVoting: source.enableVoting === undefined ? true : source.enableVoting === true,
    maxOpenPerUser: clamp(toInteger(source.maxOpenPerUser, 5), 1, 20),
    staffRoleIds: Array.isArray(source.staffRoleIds)
      ? [
          ...new Set(
            source.staffRoleIds.filter(
              (id): id is string => typeof id === 'string' && /^\d+$/.test(id),
            ),
          ),
        ].slice(0, 10)
      : [],
    notifyAuthorOnStatusChange:
      source.notifyAuthorOnStatusChange === undefined
        ? true
        : source.notifyAuthorOnStatusChange === true,
  };
}

export function buildSuggestionMessage(snapshot: SuggestionSnapshot): SuggestionMessage {
  const status = statusLabel(snapshot.status);
  const author = snapshot.anonymous ? '匿名' : `<@${snapshot.authorId}>`;
  const lines = [
    `💡 **Suggestion** · ${status}`,
    snapshot.content,
    '',
    `投稿者: ${author}`,
    snapshot.votingEnabled ? `👍 ${snapshot.upvotes} · 👎 ${snapshot.downvotes}` : '投票: 無効',
    snapshot.staffNote ? `Staff: ${snapshot.staffNote}` : null,
    `ID: \`${snapshot.id}\``,
  ].filter((line): line is string => Boolean(line));

  const components = snapshot.votingEnabled
    ? [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              custom_id: `${CUSTOM_ID_PREFIX}vote:${snapshot.id}:up`,
              label: `👍 ${snapshot.upvotes}`,
            },
            {
              type: 2,
              style: 2,
              custom_id: `${CUSTOM_ID_PREFIX}vote:${snapshot.id}:down`,
              label: `👎 ${snapshot.downvotes}`,
            },
          ],
        },
      ]
    : [];

  return {
    content: truncate(lines.join('\n'), 1990),
    components,
    allowedMentions: snapshot.anonymous ? { parse: [] } : { parse: [], users: [snapshot.authorId] },
  };
}

export function canViewSuggestion(
  snapshot: SuggestionSnapshot,
  viewer: { userId: string; canManage: boolean },
): boolean {
  return snapshot.authorId === viewer.userId || viewer.canManage;
}

export function formatSuggestionInfo(snapshot: SuggestionSnapshot, viewerUserId: string): string {
  const author = snapshot.anonymous
    ? '匿名'
    : snapshot.authorId === viewerUserId
      ? 'あなた'
      : `<@${snapshot.authorId}>`;
  const lines = [
    `💡 **Suggestion詳細** · ${statusLabel(snapshot.status)}`,
    snapshot.content,
    '',
    `投稿者: ${author}`,
    snapshot.votingEnabled ? `👍 ${snapshot.upvotes} · 👎 ${snapshot.downvotes}` : '投票: 無効',
    snapshot.staffNote ? `Staff: ${snapshot.staffNote}` : null,
    `作成: <t:${Math.floor(snapshot.createdAt.getTime() / 1000)}:F>`,
    `ID: \`${snapshot.id}\``,
  ].filter((line): line is string => Boolean(line));
  return truncate(lines.join('\n'), MAX_INFO_LENGTH);
}

async function executeSuggestionCommand(
  context: SuggestionContext,
  interaction: CommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeSuggestionConfig(context.config);
  if (!config.enabled) {
    await reply(interaction, 'Suggestion Pluginは現在無効です。');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') return handleCreate(context, config, interaction);
  if (subcommand === 'list') return handleList(context, interaction);
  if (subcommand === 'info') return handleInfo(context, config, interaction);
  if (subcommand === 'status') return handleStatus(context, config, interaction);
  await reply(interaction, '不明なSuggestion操作です。');
}

async function handleCreate(
  context: SuggestionContext,
  config: SuggestionConfig,
  interaction: CommandInteraction,
): Promise<void> {
  const content = interaction.options.getString('content', true)?.trim() ?? '';
  if (!content || content.length > MAX_CONTENT_LENGTH) {
    await reply(interaction, 'contentは1〜1000文字で入力してください。');
    return;
  }

  const channel = await resolveSuggestionChannel(context, config, interaction);
  if (!channel) {
    await reply(
      interaction,
      'Suggestion投稿先チャンネルを利用できません。Studio設定とBot権限を確認してください。',
    );
    return;
  }

  const id = await createSuggestion(context.prisma, {
    guildId: interaction.guildId!,
    authorId: interaction.user.id,
    channelId: config.suggestionChannelId ?? interaction.channelId!,
    content,
    anonymous: config.anonymousSubmissions,
    votingEnabled: config.enableVoting,
    maxOpenPerUser: config.maxOpenPerUser,
  });
  if (!id) {
    await reply(
      interaction,
      `未処理Suggestionが上限（${config.maxOpenPerUser}件）に達しています。`,
    );
    return;
  }

  let published = false;
  try {
    const snapshot = await getSuggestionSnapshot(context.prisma, id, interaction.guildId!);
    if (!snapshot) throw new Error('SuggestionSnapshotMissing');
    const message = await channel.send(buildSuggestionMessage(snapshot));
    published = true;
    await setSuggestionMessageId(context.prisma, id, message.id);
  } catch (error) {
    if (!published) await deleteSuggestion(context.prisma, id).catch(() => undefined);
    context.logger.warn(
      { err: error, guildId: interaction.guildId, suggestionId: id },
      'Suggestion投稿に失敗しました',
    );
    await reply(interaction, 'Suggestionの投稿に失敗しました。Botの送信権限を確認してください。');
    return;
  }
  await reply(interaction, `💡 Suggestionを投稿しました。\nID: \`${id}\``);
}

async function handleList(
  context: SuggestionContext,
  interaction: CommandInteraction,
): Promise<void> {
  const records = await listAuthorSuggestions(
    context.prisma,
    interaction.guildId!,
    interaction.user.id,
  );
  const pages = formatSuggestionListPages(records);
  await reply(interaction, pages[0]!);
  for (const page of pages.slice(1))
    await interaction.followUp({
      content: page,
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
}

async function handleInfo(
  context: SuggestionContext,
  config: SuggestionConfig,
  interaction: CommandInteraction,
): Promise<void> {
  const id = interaction.options.getString('id', true)?.trim() ?? '';
  if (!UUID_PATTERN.test(id)) {
    await reply(interaction, 'Suggestion IDが正しくありません。');
    return;
  }

  const snapshot = await getSuggestionSnapshot(context.prisma, id, interaction.guildId!);
  const canManage = canManageSuggestion(interaction, config);
  if (!snapshot || !canViewSuggestion(snapshot, { userId: interaction.user.id, canManage })) {
    await reply(interaction, 'Suggestionが見つからないか、表示権限がありません。');
    return;
  }

  await reply(interaction, formatSuggestionInfo(snapshot, interaction.user.id));
}

async function handleStatus(
  context: SuggestionContext,
  config: SuggestionConfig,
  interaction: CommandInteraction,
): Promise<void> {
  if (!canManageSuggestion(interaction, config)) {
    await reply(
      interaction,
      'Suggestionの状態変更にはManage Server権限または設定済みStaff Roleが必要です。',
    );
    return;
  }
  const id = interaction.options.getString('id', true)?.trim() ?? '';
  const status = interaction.options.getString('status', true) as SuggestionStatus | null;
  const note = interaction.options.getString('note')?.trim() || null;
  if (!UUID_PATTERN.test(id) || !isSuggestionStatus(status)) {
    await reply(interaction, 'Suggestion IDまたはstatusが正しくありません。');
    return;
  }
  if (note && note.length > MAX_NOTE_LENGTH) {
    await reply(interaction, 'Staffコメントは300文字以内で入力してください。');
    return;
  }

  const snapshot = await updateSuggestionStatus(context.prisma, {
    id,
    guildId: interaction.guildId!,
    status,
    staffNote: note,
  });
  if (!snapshot) {
    await reply(interaction, 'Suggestionが見つかりません。');
    return;
  }
  await updateStoredMessage(context, snapshot).catch((error) =>
    context.logger.warn({ err: error, suggestionId: id }, 'Suggestionメッセージ更新に失敗しました'),
  );
  if (config.notifyAuthorOnStatusChange) {
    await context.client.users
      .fetch(snapshot.authorId)
      .then((user) =>
        user.send({
          content: `あなたのSuggestion \`${id}\` が「${statusLabel(status)}」になりました。${note ? `\nStaff: ${note}` : ''}`,
          allowedMentions: { parse: [] },
        }),
      )
      .catch(() => undefined);
  }
  await reply(interaction, `Suggestion \`${id}\` を「${statusLabel(status)}」へ変更しました。`);
}

async function handleSuggestionComponent(
  context: SuggestionContext,
  interaction: ComponentInteraction | undefined,
): Promise<void> {
  if (
    !interaction?.isButton?.() ||
    !interaction.customId?.startsWith(CUSTOM_ID_PREFIX) ||
    !interaction.guildId
  )
    return;
  const config = normalizeSuggestionConfig(context.config);
  if (!config.enabled || !config.enableVoting) {
    await interaction.reply({
      content: 'Suggestion投票は現在無効です。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const parsed = parseVoteCustomId(interaction.customId);
  if (!parsed) return;
  const snapshot = await voteSuggestion(context.prisma, {
    id: parsed.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    value: parsed.value,
  });
  if (!snapshot) {
    await interaction.reply({
      content: 'このSuggestionには投票できません。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  await interaction.update(buildSuggestionMessage(snapshot));
}

async function resolveSuggestionChannel(
  context: SuggestionContext,
  config: SuggestionConfig,
  interaction: CommandInteraction,
): Promise<TextChannel | null> {
  if (config.suggestionChannelId) {
    const channel = await context.client.channels
      .fetch(config.suggestionChannelId)
      .catch(() => null);
    return channel?.isTextBased() ? channel : null;
  }
  return interaction.channelId && interaction.channel?.isTextBased() ? interaction.channel : null;
}

async function updateStoredMessage(
  context: SuggestionContext,
  snapshot: SuggestionSnapshot,
): Promise<void> {
  if (!snapshot.messageId) return;
  const channel = await context.client.channels.fetch(snapshot.channelId);
  if (!channel?.isTextBased()) throw new Error('SuggestionChannelUnavailable');
  const message = await channel.messages.fetch(snapshot.messageId);
  await message.edit(buildSuggestionMessage(snapshot));
}

export function formatSuggestionListPages(records: readonly SuggestionListRecord[]): string[] {
  if (records.length === 0) return ['投稿したSuggestionはありません。'];
  const pages: string[] = [];
  let current = '**あなたのSuggestion一覧**';
  for (const record of records) {
    const line = `\`${record.id}\` · ${statusLabel(record.status)} · <t:${Math.floor(record.createdAt.getTime() / 1000)}:R>\n${truncate(record.content, 120)}`;
    const next = `${current}\n\n${line}`;
    if (next.length > MAX_LIST_PAGE_LENGTH) {
      pages.push(current);
      current = `**あなたのSuggestion一覧（続き）**\n\n${line}`;
    } else {
      current = next;
    }
  }
  pages.push(current);
  return pages;
}

function canManageSuggestion(interaction: CommandInteraction, config: SuggestionConfig): boolean {
  if (interaction.memberPermissions?.has('ManageGuild')) return true;
  return config.staffRoleIds.some(
    (roleId) => interaction.member?.roles?.cache?.has(roleId) === true,
  );
}

function parseVoteCustomId(customId: string): { id: string; value: 1 | -1 } | null {
  const [action, id, direction] = customId.slice(CUSTOM_ID_PREFIX.length).split(':');
  if (action !== 'vote' || !id || !UUID_PATTERN.test(id)) return null;
  if (direction === 'up') return { id, value: 1 };
  if (direction === 'down') return { id, value: -1 };
  return null;
}

function isSuggestionStatus(value: unknown): value is SuggestionStatus {
  return (
    value === 'reviewing' || value === 'accepted' || value === 'rejected' || value === 'completed'
  );
}

function statusLabel(status: SuggestionStatus): string {
  if (status === 'pending') return '📝 未確認';
  if (status === 'reviewing') return '🔎 検討中';
  if (status === 'accepted') return '✅ 採用';
  if (status === 'rejected') return '❌ 却下';
  return '🏁 完了';
}

async function reply(interaction: CommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: EPHEMERAL_FLAG, allowedMentions: { parse: [] } });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
