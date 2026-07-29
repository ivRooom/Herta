import { definePlugin } from '@herta/plugin-sdk';
import type { CommandHandler, PluginRuntimeContext } from '@herta/plugin-sdk';
import { createLfgComponentId, parseLfgComponentId } from './component-id.js';
import { LfgValidationError, normalizeLfgConfig, type LfgConfig } from './config.js';
import { lfgManifest } from './manifest.js';
import {
  closeLfgPost,
  createLfgPost,
  getLfgPost,
  joinLfgPost,
  leaveLfgPost,
  listLfgParticipants,
  listLfgPosts,
  markLfgMessageMissing,
  markLfgMessageSynchronized,
  updateLfgMessageReference,
  type LfgPostRecord,
  type LfgPostStatus,
  type LfgPrismaClient,
} from './service.js';

const EPHEMERAL_FLAG = 64;
const MANAGE_GUILD_PERMISSION = 32n;
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15, 16]);
const ACTIVE_STATUSES = new Set<LfgPostStatus>(['open', 'full']);

interface PermissionSet {
  has(permission: bigint): boolean;
}

interface LfgCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
}

interface LfgMessageLike {
  id: string;
  edit(options: LfgMessagePayload): Promise<unknown>;
}

interface LfgChannelLike {
  id: string;
  type?: number;
  messages?: { fetch(messageId: string): Promise<LfgMessageLike> };
}

interface LfgDiscordClient {
  channels: { fetch(channelId: string): Promise<LfgChannelLike | null> };
}

interface LfgReplyOptions extends LfgMessagePayload {
  flags?: number;
  fetchReply?: boolean;
}

interface LfgCommandInteraction {
  id: string;
  guildId: string | null;
  channelId: string | null;
  user: { id: string };
  memberPermissions: PermissionSet | null;
  options: LfgCommandOptions;
  replied: boolean;
  deferred: boolean;
  reply(options: LfgReplyOptions): Promise<unknown>;
  followUp(options: LfgReplyOptions): Promise<unknown>;
}

interface LfgButtonInteraction {
  guildId: string | null;
  customId: string;
  message: { id: string };
  user: { id: string };
  replied: boolean;
  deferred: boolean;
  isButton(): boolean;
  reply(options: LfgReplyOptions): Promise<unknown>;
  followUp(options: LfgReplyOptions): Promise<unknown>;
  update(options: LfgMessagePayload): Promise<unknown>;
}

interface LfgDeletedMessage {
  id: string;
  guildId: string | null;
}

interface LfgMessagePayload {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
  components?: Array<Record<string, unknown>>;
  allowedMentions: { parse: string[] };
}

type LfgRuntimeContext = PluginRuntimeContext<LfgConfig, LfgDiscordClient, LfgPrismaClient>;

export const lfgPlugin = definePlugin<LfgConfig, LfgDiscordClient, LfgPrismaClient>({
  manifest: lfgManifest,

  async onEnable(context) {
    normalizeLfgConfig(context.config);
    getComponentSecret();
    context.logger.info('LFG Plugin v1を有効化しました');
  },

  async onDisable(context) {
    context.logger.info('LFG Plugin v1を無効化しました');
  },

  provideCommands(context) {
    const command: CommandHandler<LfgCommandInteraction> = {
      definition: lfgManifest.commands[0]!,
      async execute(interaction) {
        await executeLfgCommand(context, interaction);
      },
    };
    return [command];
  },

  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          const interaction = args[0] as LfgButtonInteraction | undefined;
          if (!interaction?.isButton()) return;
          await executeLfgButton(context, interaction);
        },
      },
      {
        event: 'messageDelete',
        async handler(context, ...args) {
          const message = args[0] as LfgDeletedMessage | undefined;
          if (!message?.guildId || message.guildId !== context.guildId) return;
          await markLfgMessageMissing(context.prisma, {
            guildId: context.guildId,
            messageId: message.id,
          });
        },
      },
    ];
  },
});

async function executeLfgCommand(
  context: LfgRuntimeContext,
  interaction: LfgCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || interaction.guildId !== context.guildId || !interaction.channelId) {
    await respond(interaction, 'このコマンドは対象サーバー内でのみ利用できます');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  try {
    if (subcommand === 'create') {
      await createPostFromCommand(context, interaction);
      return;
    }
    if (subcommand === 'show') {
      await showPost(context, interaction);
      return;
    }
    if (subcommand === 'list') {
      await listPosts(context, interaction);
      return;
    }
    if (subcommand === 'close' || subcommand === 'cancel') {
      await finalizePost(context, interaction, subcommand === 'close' ? 'closed' : 'cancelled');
      return;
    }
    await respond(interaction, '未対応のサブコマンドです');
  } catch (error) {
    if (error instanceof LfgValidationError) {
      await respond(interaction, error.message);
      return;
    }
    context.logger.error(
      { guildId: context.guildId, errorName: resolveErrorName(error), subcommand },
      'LFGコマンドの処理に失敗しました',
    );
    await respond(interaction, 'LFGの処理に失敗しました。時間をおいて再度お試しください');
  }
}

async function createPostFromCommand(
  context: LfgRuntimeContext,
  interaction: LfgCommandInteraction,
): Promise<void> {
  const game = interaction.options.getString('game', true)?.trim();
  const title = interaction.options.getString('title', true)?.trim();
  const maxPlayers = interaction.options.getInteger('max_players', true);
  if (!game || !title || maxPlayers === null) {
    await respond(interaction, 'game、title、max_playersを指定してください');
    return;
  }

  const startTimeText = interaction.options.getString('start_time');
  const startTime = startTimeText ? new Date(startTimeText) : null;
  if (startTimeText && (!startTime || !Number.isFinite(startTime.getTime()))) {
    await respond(interaction, 'start_timeは有効なISO-8601日時で指定してください');
    return;
  }

  const post = await createLfgPost(context.prisma, {
    guildId: context.guildId,
    creatorId: interaction.user.id,
    actorId: interaction.user.id,
    post: {
      channelId: interaction.channelId!,
      game,
      title,
      description: interaction.options.getString('description'),
      maxPlayers,
      startTime,
      durationMinutes: interaction.options.getInteger('duration_minutes'),
    },
    config: normalizeLfgConfig(context.config),
  });

  try {
    const reply = await interaction.reply({
      ...renderLfgMessage(post, [interaction.user.id]),
      fetchReply: true,
    });
    const messageId = readMessageId(reply);
    if (messageId) {
      await updateLfgMessageReference(context.prisma, {
        guildId: context.guildId,
        postId: post.id,
        messageId,
        actorId: interaction.user.id,
      });
    }
  } catch (error) {
    await context.prisma.lfgPost.update({
      where: { id: post.id },
      data: { messageState: 'failed', lastErrorName: resolveErrorName(error) },
    });
    throw error;
  }
}

async function showPost(
  context: LfgRuntimeContext,
  interaction: LfgCommandInteraction,
): Promise<void> {
  const postId = interaction.options.getString('id', true)?.trim();
  if (!postId) {
    await respond(interaction, '募集IDを指定してください');
    return;
  }
  const post = await getLfgPost(context.prisma, context.guildId, postId);
  if (!post) {
    await respond(interaction, '指定した募集が見つかりません');
    return;
  }
  const participants = await listLfgParticipants(context.prisma, context.guildId, post.id);
  await respond(
    interaction,
    formatPostText(
      post,
      participants.map((item) => item.userId),
    ),
  );
}

async function listPosts(
  context: LfgRuntimeContext,
  interaction: LfgCommandInteraction,
): Promise<void> {
  const rawStatus = interaction.options.getString('status');
  const status = isLfgPostStatus(rawStatus) ? rawStatus : undefined;
  const posts = await listLfgPosts(context.prisma, {
    guildId: context.guildId,
    status,
    take: 20,
  });
  if (posts.length === 0) {
    await respond(interaction, '条件に一致する募集はありません');
    return;
  }
  const lines = posts.map(
    (post) =>
      `• \`${post.id}\` **${escapeMarkdown(post.title)}** — ${post.participantCount}/${post.maxPlayers} (${post.status})`,
  );
  await respond(interaction, `LFG一覧\n${lines.join('\n')}`);
}

async function finalizePost(
  context: LfgRuntimeContext,
  interaction: LfgCommandInteraction,
  mode: 'closed' | 'cancelled',
): Promise<void> {
  const postId = interaction.options.getString('id', true)?.trim();
  if (!postId) {
    await respond(interaction, '募集IDを指定してください');
    return;
  }
  const result = await closeLfgPost(context.prisma, {
    guildId: context.guildId,
    postId,
    actorId: interaction.user.id,
    mode,
    force: interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION) ?? false,
  });
  if (result.state === 'not_found') {
    await respond(interaction, '指定した募集が見つかりません');
    return;
  }
  if (result.state === 'forbidden') {
    await respond(
      interaction,
      '募集作成者または「サーバーの管理」権限を持つユーザーだけが操作できます',
    );
    return;
  }
  if (result.state === 'already_final') {
    await respond(interaction, `この募集は既に${result.post.status}です`);
    return;
  }
  await refreshLfgMessage(context, result.post);
  await respond(
    interaction,
    mode === 'closed' ? '募集を締め切りました' : '募集をキャンセルしました',
  );
}

async function executeLfgButton(
  context: LfgRuntimeContext,
  interaction: LfgButtonInteraction,
): Promise<void> {
  if (!interaction.guildId || interaction.guildId !== context.guildId) return;
  const parsed = parseLfgComponentId(interaction.customId, getComponentSecret());
  if (!parsed) {
    await respond(interaction, 'この募集ボタンは無効です');
    return;
  }

  if (parsed.action === 'join') {
    const result = await joinLfgPost(context.prisma, {
      guildId: context.guildId,
      postId: parsed.postId,
      userId: interaction.user.id,
    });
    if (result.state === 'not_found') {
      await respond(interaction, '募集が見つかりません');
      return;
    }
    if (result.state === 'already_joined') {
      await respond(interaction, '既に参加しています');
      return;
    }
    if (result.state === 'full') {
      await respond(interaction, 'この募集は満員です');
      return;
    }
    if (result.state === 'closed') {
      await respond(interaction, 'この募集は終了しています');
      return;
    }
    await updateButtonMessage(context, interaction, result.post);
    return;
  }

  const result = await leaveLfgPost(context.prisma, {
    guildId: context.guildId,
    postId: parsed.postId,
    userId: interaction.user.id,
  });
  if (result.state === 'not_found') {
    await respond(interaction, '募集が見つかりません');
    return;
  }
  if (result.state === 'creator_must_cancel') {
    await respond(interaction, '募集作成者は辞退できません。`/lfg cancel`を使用してください');
    return;
  }
  if (result.state === 'not_joined') {
    await respond(interaction, 'この募集には参加していません');
    return;
  }
  if (result.state === 'closed') {
    await respond(interaction, 'この募集は終了しています');
    return;
  }
  await updateButtonMessage(context, interaction, result.post);
}

async function updateButtonMessage(
  context: LfgRuntimeContext,
  interaction: LfgButtonInteraction,
  post: LfgPostRecord,
): Promise<void> {
  const participants = await listLfgParticipants(context.prisma, context.guildId, post.id);
  try {
    await interaction.update(
      renderLfgMessage(
        post,
        participants.map((item) => item.userId),
      ),
    );
    await markLfgMessageSynchronized(context.prisma, {
      guildId: context.guildId,
      postId: post.id,
    });
  } catch (error) {
    context.logger.warn(
      { guildId: context.guildId, postId: post.id, errorName: resolveErrorName(error) },
      'LFG Button操作後のDiscord表示更新に失敗しました。Workerで再同期します',
    );
    if (!interaction.replied && !interaction.deferred) {
      await respond(interaction, '参加状態は更新されました。表示はWorkerが再同期します');
    }
  }
}

async function refreshLfgMessage(context: LfgRuntimeContext, post: LfgPostRecord): Promise<void> {
  if (!post.messageId) return;
  try {
    const channel = await context.client.channels.fetch(post.channelId);
    if (!channel || (channel.type !== undefined && !TEXT_CHANNEL_TYPES.has(channel.type))) return;
    const message = await channel.messages?.fetch(post.messageId);
    if (!message) return;
    const participants = await listLfgParticipants(context.prisma, context.guildId, post.id);
    await message.edit(
      renderLfgMessage(
        post,
        participants.map((item) => item.userId),
      ),
    );
    await markLfgMessageSynchronized(context.prisma, {
      guildId: context.guildId,
      postId: post.id,
    });
  } catch (error) {
    await markLfgMessageMissing(context.prisma, {
      guildId: context.guildId,
      messageId: post.messageId,
      errorName: resolveErrorName(error),
    });
  }
}

function renderLfgMessage(post: LfgPostRecord, participantIds: string[]): LfgMessagePayload {
  const active = ACTIVE_STATUSES.has(post.status);
  const participantText = participantIds.length
    ? participantIds
        .slice(0, 30)
        .map((id) => `<@${id}>`)
        .join(' ')
    : '参加者なし';
  return {
    embeds: [
      {
        title: post.title,
        description: post.description || '説明なし',
        fields: [
          { name: 'ゲーム・イベント', value: post.game, inline: true },
          {
            name: '参加人数',
            value: `${post.participantCount} / ${post.maxPlayers}`,
            inline: true,
          },
          { name: '状態', value: post.status, inline: true },
          {
            name: '開始予定',
            value: post.startTime ? discordTimestamp(post.startTime) : '未指定',
            inline: true,
          },
          { name: '募集期限', value: discordTimestamp(post.expiresAt), inline: true },
          { name: '参加者', value: participantText.slice(0, 1024) },
        ],
        footer: { text: `LFG ID: ${post.id} / v${post.version}` },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: post.status === 'full' ? '満員' : '参加',
            custom_id: createLfgComponentId('join', post.id, getComponentSecret()),
            disabled: !active || post.status === 'full',
          },
          {
            type: 2,
            style: 2,
            label: '辞退',
            custom_id: createLfgComponentId('leave', post.id, getComponentSecret()),
            disabled: !active,
          },
        ],
      },
    ],
    allowedMentions: { parse: [] },
  };
}

function formatPostText(post: LfgPostRecord, participantIds: string[]): string {
  return [
    `**${escapeMarkdown(post.title)}**`,
    `ゲーム・イベント: ${escapeMarkdown(post.game)}`,
    `状態: ${post.status}`,
    `参加人数: ${post.participantCount}/${post.maxPlayers}`,
    `開始予定: ${post.startTime ? discordTimestamp(post.startTime) : '未指定'}`,
    `募集期限: ${discordTimestamp(post.expiresAt)}`,
    `参加者: ${participantIds.length ? participantIds.map((id) => `<@${id}>`).join(' ') : 'なし'}`,
    `ID: \`${post.id}\``,
  ].join('\n');
}

async function respond(
  interaction: Pick<LfgCommandInteraction, 'replied' | 'deferred' | 'reply' | 'followUp'>,
  content: string,
): Promise<void> {
  const options: LfgReplyOptions = {
    content,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}

function isLfgPostStatus(value: string | null): value is LfgPostStatus {
  return (
    value === 'open' ||
    value === 'full' ||
    value === 'closed' ||
    value === 'cancelled' ||
    value === 'expired'
  );
}

function getComponentSecret(): string {
  const secret = process.env['LFG_COMPONENT_SECRET'] ?? '';
  if (secret.length < 32) {
    throw new Error('LFG_COMPONENT_SECRETは32文字以上で設定してください');
  }
  return secret;
}

function discordTimestamp(value: Date): string {
  return `<t:${Math.floor(value.getTime() / 1000)}:F>`;
}

function readMessageId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 100);
  return 'UnknownError';
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&');
}

export default lfgPlugin;
