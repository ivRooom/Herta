import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { ticketsManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import {
  buildTicketCreatePayload,
  buildTicketMessageBody,
  buildTicketMessagePayload,
  buildTicketThreadPayload,
  isTicketCategory,
  normalizeTicketsConfig,
  resolveTicketBridgeConfig,
  sendTicketCreate,
  sendTicketOutboxPayload,
  ticketCategoryLabel,
  TICKET_BODY_MAX_LENGTH,
  TICKET_SUBJECT_MAX_LENGTH,
  type TicketCategory,
  type TicketOutboxKind,
  type TicketsPluginConfig,
} from './tickets-core.js';
import {
  enqueueTicketPayloads,
  findTicketThreadLinkByThreadId,
  listDueTicketOutboxRows,
  markTicketOutboxDropped,
  markTicketOutboxRetry,
  markTicketOutboxSent,
  saveTicketThreadLink,
  setTicketThreadClaimedBy,
  touchTicketOutboxAuthFailure,
  type TicketThreadLinkRecord,
} from './tickets-outbox-repository.js';

const EPHEMERAL_FLAG = 64;
const CUSTOM_ID_PREFIX = 'herta:tickets:v1:';
const WORKER_INTERVAL_MS = 30_000;
const workerTimers = new Map<string, ReturnType<typeof setInterval>>();
const workerRunning = new Set<string>();

interface TicketMessageOptions {
  content: string;
  components?: Array<Record<string, unknown>>;
  allowedMentions: { parse: []; roles?: string[]; users?: string[] };
}

interface TicketThread {
  id: string;
  send(options: TicketMessageOptions): Promise<unknown>;
  members?: { add(userId: string): Promise<unknown> };
  setArchived?(archived: boolean): Promise<unknown>;
}

interface TicketChannel {
  id: string;
  isTextBased(): boolean;
  send(options: TicketMessageOptions): Promise<{ id: string }>;
  threads?: {
    create(options: {
      name: string;
      type: ChannelType.PrivateThread;
      invitable: boolean;
      reason: string;
    }): Promise<TicketThread>;
  };
}

interface TicketsClient {
  channels: { fetch(id: string): Promise<TicketChannel | null> };
}

interface CommandInteraction {
  guildId: string | null;
  channelId: string | null;
  user: { id: string; username: string; displayName?: string };
  memberPermissions?: { has(permission: string): boolean } | null;
  member?: { roles?: { cache?: { has(id: string): boolean } } } | null;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
  };
  reply(options: TicketMessageOptions & { flags?: number }): Promise<unknown>;
  showModal(modal: ModalBuilder): Promise<unknown>;
}

interface ComponentInteraction {
  id: string;
  guildId: string | null;
  channelId: string | null;
  customId?: string;
  user: { id: string; username: string; displayName?: string };
  memberPermissions?: { has(permission: string): boolean } | null;
  member?: { roles?: { cache?: { has(id: string): boolean } } } | null;
  channel?: TicketThread | null;
  isButton?(): boolean;
  isModalSubmit?(): boolean;
  fields?: { getTextInputValue(id: string): string };
  reply(options: TicketMessageOptions & { flags?: number }): Promise<unknown>;
  deferReply(options: { flags?: number }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
  showModal(modal: ModalBuilder): Promise<unknown>;
}

interface IncomingMessage {
  id: string;
  guildId: string | null;
  channelId: string;
  content?: string | null;
  author?: { id: string; bot?: boolean } | null;
  webhookId?: string | null;
  attachments?: unknown;
}

type TicketsContext = PluginRuntimeContext<TicketsPluginConfig, TicketsClient, PrismaClient>;

export const ticketsPlugin = definePlugin<TicketsPluginConfig, TicketsClient, PrismaClient>({
  manifest: ticketsManifest,
  async onEnable(context) {
    const config = normalizeTicketsConfig(context.config);
    if (config.enabled) startTicketWorker(context as TicketsContext);
  },
  async onDisable(context) {
    stopTicketWorker(context.guildId);
  },
  provideCommands(context) {
    const command: CommandHandler<CommandInteraction> = {
      definition: ticketsManifest.commands[0]!,
      async execute(interaction) {
        await executeTicketCommand(context as TicketsContext, interaction);
      },
    };
    return [command];
  },
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          await handleTicketComponent(
            context as TicketsContext,
            args[0] as ComponentInteraction | undefined,
          );
        },
      },
      {
        event: 'messageCreate',
        async handler(context, ...args) {
          await handleTicketMessage(context as TicketsContext, args[0] as IncomingMessage);
        },
      },
    ] as PluginEventHandler<TicketsPluginConfig, TicketsClient, PrismaClient>[];
  },
});

export type TicketAction = 'claim' | 'close' | 'reopen';

/**
 * スレッド内ボタンの押下を記録する案内文。契約 v1 には状態変更の
 * エンドポイントが無い (proposed-only) ため、第1段では Web 側の状態は
 * 変えず、Discord 内の記録と Admin での更新依頼に倒す。
 */
export function buildTicketActionNotice(
  action: TicketAction,
  actorId: string,
  ticketId: string,
): string {
  const actor = `<@${actorId}>`;
  if (action === 'claim') {
    return `🙋 ${actor} がこのチケット（${ticketId}）の担当を希望しました。Web側の担当者設定は Admin で行ってください。`;
  }
  if (action === 'close') {
    return `🔒 ${actor} がこのチケット（${ticketId}）のクローズを依頼しました。Web側の状態変更は Admin で行ってください。このスレッドはアーカイブされます（再オープンボタンで戻せます）。`;
  }
  return `🔓 ${actor} がこのチケット（${ticketId}）の再オープンを依頼しました。Web側の状態変更は Admin で行ってください。`;
}

export function buildTicketPanelMessage(config: TicketsPluginConfig): TicketMessageOptions {
  const buttons = config.enabledCategories.map((category) => ({
    type: 2,
    style: 1,
    custom_id: `${CUSTOM_ID_PREFIX}create:${category}`,
    label: ticketCategoryLabel(category),
  }));
  return {
    content: [
      '🎫 **問い合わせチケット**',
      '運営への問い合わせは、下のボタンからカテゴリを選んで作成できます。',
      '作成すると、あなたと運営だけが見られる非公開スレッドでやり取りが始まります。',
    ].join('\n'),
    components: buttons.length > 0 ? [{ type: 1, components: buttons }] : [],
    allowedMentions: { parse: [] },
  };
}

export function buildTicketIntroMessage(input: {
  ticketId: string;
  category: TicketCategory;
  subject: string;
  requesterId: string;
  url: string | null;
}): TicketMessageOptions {
  const lines = [
    `🎫 **チケット ${input.ticketId}** · ${ticketCategoryLabel(input.category)}`,
    `件名: ${input.subject}`,
    `起票者: <@${input.requesterId}>`,
    input.url ? `Webでの閲覧・返信: ${input.url}` : null,
    '',
    'このスレッド内のメッセージは Web のチケットにも反映されます。',
  ].filter((line): line is string => line !== null);
  return {
    content: lines.join('\n'),
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: `${CUSTOM_ID_PREFIX}action:claim`,
            label: '担当する',
          },
          {
            type: 2,
            style: 2,
            custom_id: `${CUSTOM_ID_PREFIX}action:close`,
            label: 'クローズ',
          },
          {
            type: 2,
            style: 2,
            custom_id: `${CUSTOM_ID_PREFIX}action:reopen`,
            label: '再オープン',
          },
        ],
      },
    ],
    allowedMentions: { parse: [], users: [input.requesterId] },
  };
}

async function executeTicketCommand(
  context: TicketsContext,
  interaction: CommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyEphemeral(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeTicketsConfig(context.config);
  if (!config.enabled) {
    await replyEphemeral(interaction, 'Tickets Pluginは現在無効です。');
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'panel') {
    if (!canManageTickets(interaction, config)) {
      await replyEphemeral(
        interaction,
        'パネルの設置にはManage Server権限または設定済みStaff Roleが必要です。',
      );
      return;
    }
    const channelId = config.panelChannelId ?? interaction.channelId;
    const channel = channelId
      ? await context.client.channels.fetch(channelId).catch(() => null)
      : null;
    if (!channel?.isTextBased()) {
      await replyEphemeral(
        interaction,
        'パネル設置先チャンネルを利用できません。Studio設定とBot権限を確認してください。',
      );
      return;
    }
    await channel.send(buildTicketPanelMessage(config));
    await replyEphemeral(interaction, '問い合わせパネルを設置しました。');
    return;
  }
  if (subcommand === 'create') {
    const category = interaction.options.getString('category', true);
    if (!isTicketCategory(category) || !config.enabledCategories.includes(category)) {
      await replyEphemeral(interaction, 'そのカテゴリは現在受け付けていません。');
      return;
    }
    await interaction.showModal(buildTicketModal(category));
    return;
  }
  await replyEphemeral(interaction, '不明なチケット操作です。');
}

function buildTicketModal(category: TicketCategory): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${CUSTOM_ID_PREFIX}modal:${category}`)
    .setTitle(`チケット作成（${ticketCategoryLabel(category)}）`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('subject')
          .setLabel('件名')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(TICKET_SUBJECT_MAX_LENGTH),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('body')
          .setLabel('内容')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(TICKET_BODY_MAX_LENGTH),
      ),
    );
}

async function handleTicketComponent(
  context: TicketsContext,
  interaction: ComponentInteraction | undefined,
): Promise<void> {
  if (!interaction?.customId?.startsWith(CUSTOM_ID_PREFIX) || !interaction.guildId) return;
  const config = normalizeTicketsConfig(context.config);
  if (!config.enabled) return;
  const rest = interaction.customId.slice(CUSTOM_ID_PREFIX.length);

  if (interaction.isModalSubmit?.() && rest.startsWith('modal:')) {
    const category = rest.slice('modal:'.length);
    if (isTicketCategory(category)) {
      await handleTicketModalSubmit(context, config, interaction, category);
    }
    return;
  }
  if (!interaction.isButton?.()) return;
  if (rest.startsWith('create:')) {
    const category = rest.slice('create:'.length);
    if (!isTicketCategory(category) || !config.enabledCategories.includes(category)) {
      await replyEphemeral(interaction, 'そのカテゴリは現在受け付けていません。');
      return;
    }
    await interaction.showModal(buildTicketModal(category));
    return;
  }
  if (rest.startsWith('action:')) {
    const action = rest.slice('action:'.length);
    if (action === 'claim' || action === 'close' || action === 'reopen') {
      await handleTicketAction(context, config, interaction, action);
    }
  }
}

async function handleTicketModalSubmit(
  context: TicketsContext,
  config: TicketsPluginConfig,
  interaction: ComponentInteraction,
  category: TicketCategory,
): Promise<void> {
  const bridge = resolveTicketBridgeConfig(process.env);
  if (!bridge) {
    await replyEphemeral(
      interaction,
      'チケット受付は現在停止しています（連携が未設定です）。お手数ですが運営へ直接ご連絡ください。',
    );
    return;
  }
  const subject = interaction.fields?.getTextInputValue('subject')?.trim() ?? '';
  const body = interaction.fields?.getTextInputValue('body')?.trim() ?? '';
  if (
    !subject ||
    subject.length > TICKET_SUBJECT_MAX_LENGTH ||
    !body ||
    body.length > TICKET_BODY_MAX_LENGTH
  ) {
    await replyEphemeral(interaction, '件名は1〜160文字、内容は1〜4000文字で入力してください。');
    return;
  }

  await interaction.deferReply({ flags: EPHEMERAL_FLAG });
  const payload = buildTicketCreatePayload({
    submissionId: interaction.id,
    discordUserId: interaction.user.id,
    requesterName: interaction.user.displayName ?? interaction.user.username,
    category,
    subject,
    body,
  });
  const outcome = await sendTicketCreate(bridge, payload, context.logger);
  if (outcome.kind === 'unavailable') {
    await interaction.editReply({
      content: 'チケット受付は現在停止しています。時間をおいて再度お試しください。',
    });
    return;
  }
  if (outcome.kind !== 'created') {
    await interaction.editReply({
      content: 'チケットを作成できませんでした。時間をおいて再度お試しください。',
    });
    return;
  }
  const { ticketId, url } = outcome.result;

  const panelChannelId = config.panelChannelId ?? interaction.channelId;
  const panelChannel = panelChannelId
    ? await context.client.channels.fetch(panelChannelId).catch(() => null)
    : null;
  let thread: TicketThread | null = null;
  if (panelChannel?.isTextBased() && panelChannel.threads) {
    thread = await panelChannel.threads
      .create({
        name: `🎫 ${ticketId} ${subject}`.slice(0, 100),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Ticket ${ticketId} の問い合わせスレッド`,
      })
      .catch((error) => {
        context.logger.warn({ err: error, ticketId }, 'チケット用スレッドの作成に失敗しました');
        return null;
      });
  }
  if (!thread) {
    await interaction.editReply({
      content: `チケット ${ticketId} を作成しましたが、スレッドの作成に失敗しました。${
        url ? `こちらから内容の確認と返信ができます: ${url}` : '運営が Admin から対応します。'
      }`,
    });
    return;
  }

  await thread.members?.add(interaction.user.id).catch(() => undefined);
  await saveTicketThreadLink(context.prisma, {
    ticketId,
    guildId: interaction.guildId!,
    channelId: panelChannelId!,
    threadId: thread.id,
    requesterId: interaction.user.id,
  });
  await enqueueTicketPayloads(context.prisma, interaction.guildId!, [
    buildTicketThreadPayload({
      ticketId,
      discordChannelId: panelChannelId!,
      discordThreadId: thread.id,
    }),
  ]);
  await thread
    .send(
      buildTicketIntroMessage({
        ticketId,
        category,
        subject,
        requesterId: interaction.user.id,
        url,
      }),
    )
    .catch(() => undefined);
  await notifyTicketCreated(context, config, {
    ticketId,
    category,
    subject,
    threadId: thread.id,
  });
  await interaction.editReply({
    content: `🎫 チケット ${ticketId} を作成しました。スレッド <#${thread.id}> で運営とやり取りできます。`,
  });
}

async function notifyTicketCreated(
  context: TicketsContext,
  config: TicketsPluginConfig,
  input: { ticketId: string; category: TicketCategory; subject: string; threadId: string },
): Promise<void> {
  if (!config.notifyChannelId) return;
  const channel = await context.client.channels.fetch(config.notifyChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const mention =
    config.notifyStaffOnCreate && config.staffRoleIds.length > 0
      ? `${config.staffRoleIds.map((roleId) => `<@&${roleId}>`).join(' ')}\n`
      : '';
  await channel
    .send({
      content: `${mention}🎫 新しいチケット ${input.ticketId}（${ticketCategoryLabel(input.category)}）\n件名: ${input.subject}\nスレッド: <#${input.threadId}>`,
      allowedMentions:
        config.notifyStaffOnCreate && config.staffRoleIds.length > 0
          ? { parse: [], roles: config.staffRoleIds }
          : { parse: [] },
    })
    .catch(() => undefined);
}

async function handleTicketAction(
  context: TicketsContext,
  config: TicketsPluginConfig,
  interaction: ComponentInteraction,
  action: TicketAction,
): Promise<void> {
  const link = interaction.channelId
    ? await findTicketThreadLinkByThreadId(
        context.prisma,
        interaction.guildId!,
        interaction.channelId,
      )
    : null;
  if (!link) {
    await replyEphemeral(interaction, 'このスレッドに対応するチケットが見つかりません。');
    return;
  }
  const isRequester = link.requesterId === interaction.user.id;
  const isStaff = canManageTickets(interaction, config);
  if (action === 'claim' && !isStaff) {
    await replyEphemeral(interaction, '担当操作にはStaff権限が必要です。');
    return;
  }
  if (action !== 'claim' && !isRequester && !isStaff) {
    await replyEphemeral(interaction, 'この操作を行う権限がありません。');
    return;
  }

  if (action === 'claim') {
    await setTicketThreadClaimedBy(
      context.prisma,
      interaction.guildId!,
      interaction.channelId!,
      interaction.user.id,
    );
  }
  await interaction.reply({
    content: buildTicketActionNotice(action, interaction.user.id, link.ticketId),
    allowedMentions: { parse: [], users: [interaction.user.id] },
  });
  const thread = interaction.channel;
  if (action === 'close') await thread?.setArchived?.(true).catch(() => undefined);
  if (action === 'reopen') await thread?.setArchived?.(false).catch(() => undefined);
}

async function handleTicketMessage(
  context: TicketsContext,
  message: IncomingMessage | undefined,
): Promise<void> {
  if (!message?.guildId) return;
  // Bot 自身・他 Bot・Webhook のメッセージは取り込まない (同期ループ防止)。
  if (message.author?.bot || message.webhookId) return;
  if (!message.author?.id) return;
  const config = normalizeTicketsConfig(context.config);
  if (!config.enabled) return;

  const link: TicketThreadLinkRecord | null = await findTicketThreadLinkByThreadId(
    context.prisma,
    message.guildId,
    message.channelId,
  ).catch(() => null);
  if (!link) return;

  const attachments = attachmentRefs(message.attachments);
  const body = buildTicketMessageBody(message.content ?? '', attachments);
  if (!body.trim()) return;
  await enqueueTicketPayloads(context.prisma, message.guildId, [
    buildTicketMessagePayload({
      ticketId: link.ticketId,
      authorDiscordUserId: message.author.id,
      discordMessageId: message.id,
      body,
    }),
  ]).catch((error) =>
    context.logger.warn(
      { err: error, ticketId: link.ticketId },
      'チケット返信の登録に失敗しました',
    ),
  );
}

function attachmentRefs(attachments: unknown): Array<{ name: string; url: string }> {
  const collect = (value: unknown): Array<{ name: string; url: string }> => {
    if (!value || typeof value !== 'object') return [];
    const record = value as { name?: unknown; url?: unknown };
    if (typeof record.name === 'string' && typeof record.url === 'string') {
      return [{ name: record.name, url: record.url }];
    }
    return [];
  };
  if (Array.isArray(attachments)) return attachments.flatMap(collect);
  if (
    attachments &&
    typeof attachments === 'object' &&
    typeof (attachments as { values?: unknown }).values === 'function'
  ) {
    return [...(attachments as { values(): Iterable<unknown> }).values()].flatMap(collect);
  }
  return [];
}

function startTicketWorker(context: TicketsContext): void {
  stopTicketWorker(context.guildId);
  void runTicketOutboxCycle(context);
  const timer = setInterval(() => void runTicketOutboxCycle(context), WORKER_INTERVAL_MS);
  timer.unref();
  workerTimers.set(context.guildId, timer);
}

function stopTicketWorker(guildId: string): void {
  const timer = workerTimers.get(guildId);
  if (timer) clearInterval(timer);
  workerTimers.delete(guildId);
}

/**
 * outbox の配送サイクル。401 (署名・設定異常) ではその Guild の worker を
 * 止めて明示し、行は pending のまま残す (設定を直して再有効化すれば再開)。
 */
export async function runTicketOutboxCycle(context: TicketsContext): Promise<void> {
  if (workerRunning.has(context.guildId)) return;
  const bridge = resolveTicketBridgeConfig(process.env);
  if (!bridge) return;
  workerRunning.add(context.guildId);
  try {
    const rows = await listDueTicketOutboxRows(context.prisma, context.guildId, new Date());
    for (const row of rows) {
      if (!isTicketOutboxKind(row.kind)) {
        await markTicketOutboxDropped(context.prisma, row.id, 0);
        continue;
      }
      const result = await sendTicketOutboxPayload(
        bridge,
        { kind: row.kind, eventId: row.eventId, body: row.body },
        context.logger,
      );
      if (result.outcome === 'sent') {
        await markTicketOutboxSent(context.prisma, row.id, result.status ?? 200, new Date());
      } else if (result.outcome === 'dropped') {
        await markTicketOutboxDropped(context.prisma, row.id, result.status ?? 0);
      } else if (result.outcome === 'auth_failure') {
        await touchTicketOutboxAuthFailure(context.prisma, row.id, result.status ?? 401);
        context.logger.error(
          { guildId: context.guildId, ticketId: row.ticketId },
          'チケット配送が認証エラーで停止しました。HERTA_TICKET_SECRET を確認してください',
        );
        stopTicketWorker(context.guildId);
        return;
      } else {
        await markTicketOutboxRetry(
          context.prisma,
          row,
          { status: result.status, error: result.error },
          new Date(),
        );
      }
    }
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: context.guildId },
      'チケット配送サイクルに失敗しました',
    );
  } finally {
    workerRunning.delete(context.guildId);
  }
}

function isTicketOutboxKind(value: string): value is TicketOutboxKind {
  return value === 'create' || value === 'thread' || value === 'message';
}

function canManageTickets(
  interaction: CommandInteraction | ComponentInteraction,
  config: TicketsPluginConfig,
): boolean {
  if (interaction.memberPermissions?.has('ManageGuild')) return true;
  return config.staffRoleIds.some(
    (roleId) => interaction.member?.roles?.cache?.has(roleId) === true,
  );
}

async function replyEphemeral(
  interaction: CommandInteraction | ComponentInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, flags: EPHEMERAL_FLAG, allowedMentions: { parse: [] } });
}
