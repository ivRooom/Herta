import { definePlugin } from '@herta/plugin-sdk';
import type { CommandHandler, PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  DailyContentValidationError,
  assertSafeMentions,
  normalizeDailyContentConfig,
  normalizeMessageStudioEmbed,
  type DailyContentConfig,
  type MessageStudioEmbed,
} from './config.js';
import { dailyContentManifest } from './manifest.js';
import {
  formatMessageStudioWeekdays,
  parseDiscordMessageUrl,
  parseMessageStudioWeekdays,
  toDiscordApiEmbed,
} from './message.js';
import { parseLocalDateTime } from './schedule.js';
import {
  createDailyContent,
  deleteDailyContent,
  getDailyContent,
  listDailyContents,
  reserveManualDelivery,
  type DailyContentPrismaClient,
} from './service.js';

const EPHEMERAL_FLAG = 64;
const MANAGE_GUILD_PERMISSION = 32n;
const MAX_PREVIEW_LENGTH = 1900;

interface PermissionSet {
  has(permission: bigint): boolean;
}

interface CommandChannelOption {
  id: string;
}

interface CommandAttachment {
  url: string;
  contentType?: string | null;
  name?: string | null;
}

interface DailyContentCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
  getBoolean(name: string, required?: boolean): boolean | null;
  getChannel(name: string, required?: boolean): CommandChannelOption | null;
  getAttachment(name: string, required?: boolean): CommandAttachment | null;
}

interface DailyContentCommandInteraction {
  id: string;
  guildId: string | null;
  user: { id: string };
  memberPermissions: PermissionSet | null;
  options: DailyContentCommandOptions;
  replied: boolean;
  deferred: boolean;
  reply(options: DailyContentReplyOptions): Promise<unknown>;
  followUp(options: DailyContentReplyOptions): Promise<unknown>;
}

interface DailyContentReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

interface MessagePayload {
  content?: string;
  embeds?: unknown[];
  files?: string[];
  allowedMentions: { parse: [] | ['users']; repliedUser?: boolean };
}

interface SentMessage {
  id: string;
  crosspost?(): Promise<unknown>;
  reply(payload: MessagePayload): Promise<SentMessage>;
}

interface MessageTargetChannel {
  id: string;
  isTextBased?(): boolean;
  isThreadOnly?(): boolean;
  send?(payload: MessagePayload): Promise<SentMessage>;
  messages?: { fetch(messageId: string): Promise<SentMessage> };
  threads?: {
    create(input: { name: string; message: MessagePayload }): Promise<{
      message?: SentMessage | null;
      fetchStarterMessage?(): Promise<SentMessage | null>;
    }>;
  };
}

interface MessageStudioClient {
  channels: { fetch(channelId: string): Promise<MessageTargetChannel | null> };
}

type DailyContentRuntimeContext = PluginRuntimeContext<
  DailyContentConfig,
  MessageStudioClient,
  DailyContentPrismaClient
>;

export const dailyContentPlugin = definePlugin<
  DailyContentConfig,
  MessageStudioClient,
  DailyContentPrismaClient
>({
  manifest: dailyContentManifest,

  async onEnable(context) {
    normalizeDailyContentConfig(context.config);
    context.logger.info('Announcement / Message Studio v2を有効化しました');
  },

  async onDisable(context) {
    context.logger.info('Announcement / Message Studio v2を無効化しました');
  },

  provideCommands(context) {
    return dailyContentManifest.commands.map((definition) => ({
      definition,
      async execute(interaction: DailyContentCommandInteraction) {
        await executeMessageStudioCommand(context, interaction, definition.name);
      },
    })) as CommandHandler<DailyContentCommandInteraction>[];
  },
});

async function executeMessageStudioCommand(
  context: DailyContentRuntimeContext,
  interaction: DailyContentCommandInteraction,
  commandName: string,
): Promise<void> {
  if (!interaction.guildId || interaction.guildId !== context.guildId) {
    await respond(interaction, 'このコマンドは対象サーバー内でのみ利用できます');
    return;
  }
  if (!interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION)) {
    await respond(interaction, 'この操作には「サーバーの管理」権限が必要です');
    return;
  }

  try {
    if (commandName === 'daily') {
      await executeLegacyDaily(context, interaction);
      return;
    }
    if (commandName === 'announce') {
      await executeAnnouncement(context, interaction);
      return;
    }
    if (commandName === 'say') {
      await executeSay(context, interaction);
      return;
    }
    await respond(interaction, '未対応のMessage Studioコマンドです');
  } catch (error) {
    if (error instanceof DailyContentValidationError) {
      await respond(interaction, `⚠️ ${error.message}`);
      return;
    }
    context.logger.error({ error }, 'Message Studioコマンドの実行に失敗しました');
    await respond(interaction, 'Message Studioの処理に失敗しました。Bot権限と投稿先を確認してください。');
  }
}

async function executeLegacyDaily(
  context: DailyContentRuntimeContext,
  interaction: DailyContentCommandInteraction,
): Promise<void> {
  const scheduleId = interaction.options.getString('schedule_id', true)?.trim();
  if (!scheduleId) throw new DailyContentValidationError('schedule_idを指定してください');
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'preview') {
    const schedule = await getDailyContent(context.prisma, context.guildId, scheduleId);
    if (!schedule) return respond(interaction, '指定したMessage Studio投稿が見つかりません');
    const heading = schedule.title ? `**${escapeMarkdown(schedule.title)}**\n` : '';
    const body = `${heading}${schedule.content}`;
    const truncated =
      body.length > MAX_PREVIEW_LENGTH
        ? `${body.slice(0, MAX_PREVIEW_LENGTH - 20)}\n…（省略）`
        : body;
    await respond(
      interaction,
      `プレビュー（<#${schedule.channelId}> / ${schedule.scheduleTime} ${schedule.timezone}）\n\n${truncated}`,
    );
    return;
  }
  if (subcommand === 'publish') {
    const delivery = await reserveManualDelivery(context.prisma, {
      guildId: context.guildId,
      scheduleId,
      actorId: interaction.user.id,
      requestId: interaction.id,
    });
    await respond(
      interaction,
      delivery
        ? `手動配信をキューへ追加しました（配信ID: ${delivery.id}）`
        : '指定したMessage Studio投稿が見つかりません',
    );
    return;
  }
  await respond(interaction, '未対応のサブコマンドです');
}

async function executeAnnouncement(
  context: DailyContentRuntimeContext,
  interaction: DailyContentCommandInteraction,
): Promise<void> {
  const config = normalizeDailyContentConfig(context.config);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'send') {
    const channelId = resolveChannelId(interaction, config, false);
    const payload = buildImmediatePayload(interaction, config);
    const crosspost = interaction.options.getBoolean('crosspost') === true;
    if (crosspost && !config.allowAnnouncementCrosspost) {
      throw new DailyContentValidationError('Announcement CrosspostはPlugin設定で許可されていません');
    }
    const sent = await sendToTarget(context.client, channelId, payload, readForumTitle(interaction));
    if (crosspost && sent.crosspost) await sent.crosspost();
    await respond(interaction, `📢 <#${channelId}> へお知らせを投稿しました（${sent.id}）`);
    return;
  }
  if (subcommand === 'schedule') {
    const channelId = resolveChannelId(interaction, config, false);
    const at = requiredOption(interaction, 'at');
    const onceAt = parseLocalDateTime(at, config.defaultTimezone);
    if (onceAt.getTime() < Date.now() + 60_000) {
      throw new DailyContentValidationError('予約日時は現在時刻より1分以上先を指定してください');
    }
    const schedule = await createDailyContent(context.prisma, {
      guildId: context.guildId,
      actorId: interaction.user.id,
      config,
      schedule: {
        channelId,
        title: readForumTitle(interaction),
        ...readStoredMessage(interaction, config),
        scheduleTime: at.trim().slice(-5),
        timezone: config.defaultTimezone,
        recurrenceType: 'once',
        onceAt,
        publishAnnouncement: interaction.options.getBoolean('crosspost') === true,
      },
    });
    await respond(
      interaction,
      `🗓️ 1回予約を作成しました（ID: ${schedule.id} / <t:${Math.floor(onceAt.getTime() / 1000)}:F>）`,
    );
    return;
  }
  if (subcommand === 'recurring') {
    const channelId = resolveChannelId(interaction, config, false);
    const cadence = requiredOption(interaction, 'cadence');
    if (cadence !== 'daily' && cadence !== 'weekly') {
      throw new DailyContentValidationError('cadenceはdailyまたはweeklyを指定してください');
    }
    const scheduleTime = requiredOption(interaction, 'time');
    const weekdays = cadence === 'weekly' ? parseMessageStudioWeekdays(interaction.options.getString('weekdays')) : [];
    const schedule = await createDailyContent(context.prisma, {
      guildId: context.guildId,
      actorId: interaction.user.id,
      config,
      schedule: {
        channelId,
        title: readForumTitle(interaction),
        ...readStoredMessage(interaction, config),
        scheduleTime,
        timezone: config.defaultTimezone,
        recurrenceType: cadence,
        weekdays,
        publishAnnouncement: interaction.options.getBoolean('crosspost') === true,
      },
    });
    const cadenceText = cadence === 'daily' ? `毎日 ${scheduleTime}` : `毎週 ${formatMessageStudioWeekdays(weekdays)} ${scheduleTime}`;
    await respond(interaction, `🔁 定期投稿を作成しました（ID: ${schedule.id} / ${cadenceText} ${config.defaultTimezone}）`);
    return;
  }
  if (subcommand === 'list') {
    const schedules = (await listDailyContents(context.prisma, context.guildId)).slice(0, 20);
    if (schedules.length === 0) return respond(interaction, '登録中のMessage Studio投稿はありません。');
    const lines = schedules.map((item) => {
      const cadence = item.recurrenceType === 'once'
        ? item.onceAt ? `<t:${Math.floor(item.onceAt.getTime() / 1000)}:F>` : '1回'
        : item.recurrenceType === 'weekly'
          ? `毎週 ${formatMessageStudioWeekdays(item.weekdays)} ${item.scheduleTime}`
          : `毎日 ${item.scheduleTime}`;
      return `${item.enabled ? '🟢' : '⚪'} \`${item.id}\` · <#${item.channelId}> · ${cadence} · ${item.messageFormat}`;
    });
    await respond(interaction, `**📨 Message Studio予約一覧**\n${lines.join('\n')}`.slice(0, 1950));
    return;
  }
  if (subcommand === 'cancel') {
    const id = requiredOption(interaction, 'id');
    const deleted = await deleteDailyContent(context.prisma, {
      guildId: context.guildId,
      scheduleId: id,
      actorId: interaction.user.id,
    });
    await respond(interaction, deleted ? `🛑 予約 ${id} を停止しました。` : '指定した予約が見つかりません。');
    return;
  }
  await respond(interaction, '未対応のお知らせ操作です');
}

async function executeSay(
  context: DailyContentRuntimeContext,
  interaction: DailyContentCommandInteraction,
): Promise<void> {
  const config = normalizeDailyContentConfig(context.config);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'send') {
    const channelId = resolveChannelId(interaction, config, true);
    const payload = buildImmediatePayload(interaction, config);
    const sent = await sendToTarget(context.client, channelId, payload, readForumTitle(interaction));
    await respond(interaction, `💬 <#${channelId}> へBotとして投稿しました（${sent.id}）`);
    return;
  }
  if (subcommand === 'reply') {
    const reference = parseDiscordMessageUrl(requiredOption(interaction, 'message_url'));
    if (reference.guildId !== context.guildId) {
      throw new DailyContentValidationError('別サーバーのメッセージには返信できません');
    }
    const channel = await context.client.channels.fetch(reference.channelId);
    if (!channel?.messages) throw new DailyContentValidationError('返信先チャンネルを取得できません');
    const target = await channel.messages.fetch(reference.messageId);
    const mentionUser = interaction.options.getBoolean('mention_user') ?? config.defaultMentionRepliedUser;
    const payload = buildImmediatePayload(interaction, config, mentionUser);
    const sent = await target.reply(payload);
    await respond(interaction, `↩️ 指定メッセージへ返信しました（${sent.id}）`);
    return;
  }
  await respond(interaction, '未対応のBot発言操作です');
}

function readStoredMessage(interaction: DailyContentCommandInteraction, config: DailyContentConfig) {
  const content = interaction.options.getString('content') ?? '';
  assertSafeMentions(content, config.allowUserMentions);
  const embed = readEmbed(interaction, config);
  if (!content.trim() && !embed) throw new DailyContentValidationError('本文またはEmbedを入力してください');
  return {
    content,
    messageFormat: interaction.options.getString('format') === 'embed' ? ('embed' as const) : ('text' as const),
    embed,
  };
}

function buildImmediatePayload(
  interaction: DailyContentCommandInteraction,
  config: DailyContentConfig,
  repliedUser?: boolean,
): MessagePayload {
  const content = interaction.options.getString('content')?.trim() ?? '';
  assertSafeMentions(content, config.allowUserMentions);
  const embed = readEmbed(interaction, config);
  const attachment = interaction.options.getAttachment('image');
  if (!content && !embed && !attachment) {
    throw new DailyContentValidationError('本文・Embed・画像のいずれかを入力してください');
  }
  const apiEmbed = toDiscordApiEmbed(embed);
  return {
    ...(content ? { content } : {}),
    ...(apiEmbed ? { embeds: [apiEmbed] } : {}),
    ...(attachment ? { files: [attachment.url] } : {}),
    allowedMentions: {
      parse: config.allowUserMentions ? ['users'] : [],
      ...(repliedUser !== undefined ? { repliedUser } : {}),
    },
  };
}

function readEmbed(
  interaction: DailyContentCommandInteraction,
  config: DailyContentConfig,
): MessageStudioEmbed | null {
  return normalizeMessageStudioEmbed(
    {
      title: interaction.options.getString('embed_title'),
      description: interaction.options.getString('embed_description'),
      color: interaction.options.getString('color'),
      imageUrl: interaction.options.getString('image_url'),
      thumbnailUrl: interaction.options.getString('thumbnail_url'),
      footerText: interaction.options.getString('footer'),
    },
    config.allowUserMentions,
  );
}

async function sendToTarget(
  client: MessageStudioClient,
  channelId: string,
  payload: MessagePayload,
  forumTitle: string,
): Promise<SentMessage> {
  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new DailyContentValidationError('投稿先チャンネルを取得できません');
  if (channel.isThreadOnly?.()) {
    if (!channel.threads) throw new DailyContentValidationError('Forumへ投稿できません');
    const thread = await channel.threads.create({ name: forumTitle || 'お知らせ', message: payload });
    const starter = thread.message ?? (await thread.fetchStarterMessage?.());
    if (!starter) throw new DailyContentValidationError('Forum starter messageを取得できません');
    return starter;
  }
  if (!channel.send || (channel.isTextBased && !channel.isTextBased())) {
    throw new DailyContentValidationError('このチャンネル種別には投稿できません');
  }
  return channel.send(payload);
}

function resolveChannelId(
  interaction: DailyContentCommandInteraction,
  config: DailyContentConfig,
  required: boolean,
): string {
  const selected = interaction.options.getChannel('channel')?.id;
  const channelId = selected ?? config.defaultAnnouncementChannelId;
  if (!channelId && required) throw new DailyContentValidationError('投稿先channelを指定してください');
  if (!channelId) throw new DailyContentValidationError('投稿先channelを指定するか、既定のお知らせチャンネルを設定してください');
  return channelId;
}

function readForumTitle(interaction: DailyContentCommandInteraction): string {
  return (interaction.options.getString('embed_title') ?? 'お知らせ').trim().slice(0, 100) || 'お知らせ';
}

function requiredOption(interaction: DailyContentCommandInteraction, name: string): string {
  const value = interaction.options.getString(name, true)?.trim();
  if (!value) throw new DailyContentValidationError(`${name}を指定してください`);
  return value;
}

async function respond(interaction: DailyContentCommandInteraction, content: string): Promise<void> {
  const options: DailyContentReplyOptions = {
    content,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  };
  if (interaction.replied || interaction.deferred) await interaction.followUp(options);
  else await interaction.reply(options);
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&');
}

export default dailyContentPlugin;
