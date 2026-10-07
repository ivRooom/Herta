import {
  AuditLogEvent,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildEmoji,
  type Message,
  type PartialMessage,
  type VoiceState,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { activityLogManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import { incrementCommunityActivity } from '../activity/community-activity.js';
import {
  countRecentUserEvents,
  listMemberActivityEvents,
  recordMemberActivityEvent,
  type MemberActivityEventType,
} from './activity-log-repository.js';

export interface ActivityLogConfig {
  enabled: boolean;
  trackVoice: boolean;
  trackMessages: boolean;
  trackEmoji: boolean;
  excludedChannelIds: string[];
  excludedRoleIds: string[];
  moderationAlertsEnabled: boolean;
  alertChannelId: string | null;
  messageBurstThreshold: number;
  messageBurstWindowSeconds: number;
  deleteBurstThreshold: number;
  deleteBurstWindowSeconds: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizedIds(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const idPattern = /^\d+$/;
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === 'string' && idPattern.test(item)),
    ),
  ].slice(0, maxItems);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? Math.trunc(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizedChannelId(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}

export function normalizeActivityLogConfig(value: unknown): ActivityLogConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === true,
    trackVoice: source.trackVoice === undefined ? true : source.trackVoice === true,
    trackMessages: source.trackMessages === undefined ? true : source.trackMessages === true,
    trackEmoji: source.trackEmoji === undefined ? true : source.trackEmoji === true,
    excludedChannelIds: normalizedIds(source.excludedChannelIds, 50),
    excludedRoleIds: normalizedIds(source.excludedRoleIds, 50),
    moderationAlertsEnabled: source.moderationAlertsEnabled === true,
    alertChannelId: normalizedChannelId(source.alertChannelId),
    messageBurstThreshold: clampInt(source.messageBurstThreshold, 8, 3, 50),
    messageBurstWindowSeconds: clampInt(source.messageBurstWindowSeconds, 10, 5, 300),
    deleteBurstThreshold: clampInt(source.deleteBurstThreshold, 5, 3, 50),
    deleteBurstWindowSeconds: clampInt(source.deleteBurstWindowSeconds, 30, 5, 300),
  };
}

type ActivityLogRuntimeContext = PluginRuntimeContext<ActivityLogConfig, unknown, PrismaClient>;

function isExcludedChannel(config: ActivityLogConfig, channelId: string | null): boolean {
  return Boolean(channelId && config.excludedChannelIds.includes(channelId));
}

function hasExcludedRole(config: ActivityLogConfig, roleIds: readonly string[]): boolean {
  return roleIds.some((roleId) => config.excludedRoleIds.includes(roleId));
}

async function record(
  context: ActivityLogRuntimeContext,
  input: Parameters<typeof recordMemberActivityEvent>[1],
): Promise<void> {
  try {
    await recordMemberActivityEvent(context.prisma, input);
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: context.guildId, event: input.event },
      'Activity Logの記録に失敗しました',
    );
  }
}

/**
 * burst alert(連投・連続削除の検知通知)のcooldown管理。guild+user+種別ごとに
 * 直近の通知時刻だけプロセス内メモリで持つ(再起動で消えても実害はない)。
 */
const lastBurstAlertAt = new Map<string, number>();

function burstAlertKey(guildId: string, userId: string, kind: string): string {
  return `${guildId}:${userId}:${kind}`;
}

async function maybeSendBurstAlert(
  context: ActivityLogRuntimeContext,
  guild: Guild,
  config: ActivityLogConfig,
  userId: string,
  kind: 'message_burst' | 'delete_burst',
  count: number,
  windowSeconds: number,
): Promise<void> {
  if (!config.alertChannelId) return;
  const key = burstAlertKey(context.guildId, userId, kind);
  const now = Date.now();
  const last = lastBurstAlertAt.get(key) ?? 0;
  if (now - last < windowSeconds * 1000) return;
  lastBurstAlertAt.set(key, now);

  try {
    const channel = await guild.channels.fetch(config.alertChannelId);
    if (!channel?.isTextBased()) return;
    const title =
      kind === 'message_burst' ? '⚠️ 短時間の大量投稿を検知' : '⚠️ 短時間の大量削除を検知';
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(
        `<@${userId}> が直近${windowSeconds}秒間に${count}件のイベントを記録しました。`,
      )
      .setColor(0xed4245)
      .setTimestamp(new Date());
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: context.guildId, userId, kind },
      'Burst Alertの送信に失敗しました',
    );
  }
}

/** Audit Logからemoji操作の実行者を割引きで特定する(View Audit Log権限が無い・未確定の場合はnull)。 */
async function resolveEmojiActorId(
  guild: Guild,
  auditLogEvent: AuditLogEvent,
  targetId: string,
): Promise<string | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditLogEvent, limit: 5 });
    const entry = logs.entries.find((candidate) => candidate.targetId === targetId);
    return entry?.executorId ?? null;
  } catch {
    return null;
  }
}

function handleVoiceStateUpdate(
  context: ActivityLogRuntimeContext,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackVoice) return Promise.resolve();
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return Promise.resolve();
  const roleIds = [...member.roles.cache.keys()];
  if (hasExcludedRole(config, roleIds)) return Promise.resolve();

  const tasks: Promise<void>[] = [];
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    if (!isExcludedChannel(config, oldState.channelId)) {
      tasks.push(
        record(context, {
          guildId: context.guildId,
          userId: member.id,
          event: 'voice_leave',
          channelId: oldState.channelId,
        }),
      );
    }
  }
  if (newState.channelId && oldState.channelId !== newState.channelId) {
    if (!isExcludedChannel(config, newState.channelId)) {
      tasks.push(
        record(context, {
          guildId: context.guildId,
          userId: member.id,
          event: 'voice_join',
          channelId: newState.channelId,
        }),
      );
    }
  }
  return Promise.all(tasks).then(() => undefined);
}

async function handleMessageCreate(
  context: ActivityLogRuntimeContext,
  message: Message,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackMessages) return;
  if (message.author.bot || message.webhookId) return;
  if (isExcludedChannel(config, message.channelId)) return;
  const roleIds = message.member ? [...message.member.roles.cache.keys()] : [];
  if (hasExcludedRole(config, roleIds)) return;

  await record(context, {
    guildId: context.guildId,
    userId: message.author.id,
    event: 'message_create',
    channelId: message.channelId,
    messageId: message.id,
  });

  if (config.moderationAlertsEnabled && message.guild) {
    const since = new Date(Date.now() - config.messageBurstWindowSeconds * 1000);
    const count = await countRecentUserEvents(context.prisma, {
      guildId: context.guildId,
      userId: message.author.id,
      event: 'message_create',
      since,
    });
    if (count >= config.messageBurstThreshold) {
      await maybeSendBurstAlert(
        context,
        message.guild,
        config,
        message.author.id,
        'message_burst',
        count,
        config.messageBurstWindowSeconds,
      );
    }
  }
}

async function handleMessageUpdate(
  context: ActivityLogRuntimeContext,
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackMessages) return;
  const author = newMessage.author ?? oldMessage.author;
  const channelId = newMessage.channelId ?? oldMessage.channelId;
  if (!author || author.bot || !channelId) return;
  if (isExcludedChannel(config, channelId)) return;

  await record(context, {
    guildId: context.guildId,
    userId: author.id,
    event: 'message_update',
    channelId,
    messageId: newMessage.id ?? oldMessage.id ?? undefined,
    content: oldMessage.content ?? null,
  });

  await incrementCommunityActivity(
    context.prisma,
    context.guildId,
    author.id,
    'messages_edited',
    1,
    new Date(),
    channelId,
  );
}

async function handleMessageDelete(
  context: ActivityLogRuntimeContext,
  message: Message | PartialMessage,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackMessages) return;
  if (!message.channelId) return;
  if (message.author?.bot) return;
  if (isExcludedChannel(config, message.channelId)) return;

  await record(context, {
    guildId: context.guildId,
    userId: message.author?.id ?? null,
    event: 'message_delete',
    channelId: message.channelId,
    messageId: message.id,
    content: message.content ?? null,
  });

  const userId = message.author?.id;
  if (!userId) return;

  await incrementCommunityActivity(
    context.prisma,
    context.guildId,
    userId,
    'messages_deleted',
    1,
    new Date(),
    message.channelId,
  );

  if (config.moderationAlertsEnabled && message.guild) {
    const since = new Date(Date.now() - config.deleteBurstWindowSeconds * 1000);
    const count = await countRecentUserEvents(context.prisma, {
      guildId: context.guildId,
      userId,
      event: 'message_delete',
      since,
    });
    if (count >= config.deleteBurstThreshold) {
      await maybeSendBurstAlert(
        context,
        message.guild,
        config,
        userId,
        'delete_burst',
        count,
        config.deleteBurstWindowSeconds,
      );
    }
  }
}

async function handleEmojiEvent(
  context: ActivityLogRuntimeContext,
  event: MemberActivityEventType,
  auditLogEvent: AuditLogEvent,
  emoji: GuildEmoji,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackEmoji || !emoji.guild) return;

  const actorId = await resolveEmojiActorId(emoji.guild, auditLogEvent, emoji.id);
  await record(context, {
    guildId: context.guildId,
    userId: actorId,
    event,
    metadata: { emojiId: emoji.id, emojiName: emoji.name },
  });

  if (actorId) {
    await incrementCommunityActivity(context.prisma, context.guildId, actorId, 'emoji_actions', 1);
  }
}

async function executeActivityLogCommand(
  context: ActivityLogRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'サーバー内でのみ利用できます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const hasPermission =
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!hasPermission) {
    await interaction.reply({
      content: 'このコマンドは「サーバーの管理」権限を持つユーザーだけが利用できます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user');
  const eventFilter = interaction.options.getString('event') as MemberActivityEventType | null;
  const limit = interaction.options.getInteger('limit') ?? 10;

  const rows = await listMemberActivityEvents(context.prisma, {
    guildId: interaction.guildId,
    userId: targetUser?.id,
    event: eventFilter ?? undefined,
    limit,
  });

  if (rows.length === 0) {
    await interaction.reply({
      content: '該当するログがありません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = rows.map((row) => {
    const timestamp = `<t:${Math.floor(row.occurredAt.getTime() / 1000)}:R>`;
    const who = row.userId ? `<@${row.userId}>` : '不明';
    const where = row.channelId ? `<#${row.channelId}>` : '';
    const snippet = row.content
      ? ` — \`${row.content.slice(0, 80)}${row.content.length > 80 ? '…' : ''}\``
      : row.contentScrubbedAt
        ? ' (本文は保持期間終了のため削除済み)'
        : '';
    return `${timestamp} **${row.event}** ${who} ${where}${snippet}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('📜 Activity Log')
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: `最大${limit}件 · 新しい順` });

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

export const activityLogPlugin = definePlugin<ActivityLogConfig, unknown, PrismaClient>({
  manifest: activityLogManifest,
  provideCommands(context) {
    return [
      {
        definition: activityLogManifest.commands[0]!,
        async execute(interaction) {
          await executeActivityLogCommand(context, interaction);
        },
      } as CommandHandler<ChatInputCommandInteraction>,
    ];
  },
  provideEvents(context) {
    return [
      {
        event: 'messageCreate',
        async handler(_ctx, ...args) {
          await handleMessageCreate(context, args[0] as Message);
        },
      },
      {
        event: 'messageUpdate',
        async handler(_ctx, ...args) {
          await handleMessageUpdate(
            context,
            args[0] as Message | PartialMessage,
            args[1] as Message | PartialMessage,
          );
        },
      },
      {
        event: 'messageDelete',
        async handler(_ctx, ...args) {
          await handleMessageDelete(context, args[0] as Message | PartialMessage);
        },
      },
      {
        event: 'voiceStateUpdate',
        async handler(_ctx, ...args) {
          await handleVoiceStateUpdate(context, args[0] as VoiceState, args[1] as VoiceState);
        },
      },
      {
        event: 'guildEmojiCreate',
        async handler(_ctx, ...args) {
          await handleEmojiEvent(
            context,
            'emoji_create',
            AuditLogEvent.EmojiCreate,
            args[0] as GuildEmoji,
          );
        },
      },
      {
        event: 'guildEmojiUpdate',
        async handler(_ctx, ...args) {
          await handleEmojiEvent(
            context,
            'emoji_update',
            AuditLogEvent.EmojiUpdate,
            args[1] as GuildEmoji,
          );
        },
      },
      {
        event: 'guildEmojiDelete',
        async handler(_ctx, ...args) {
          await handleEmojiEvent(
            context,
            'emoji_delete',
            AuditLogEvent.EmojiDelete,
            args[0] as GuildEmoji,
          );
        },
      },
    ];
  },
});
