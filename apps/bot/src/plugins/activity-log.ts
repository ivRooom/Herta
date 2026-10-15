import {
  AuditLogEvent,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type DMChannel,
  type Guild,
  type GuildBan,
  type GuildEmoji,
  type GuildMember,
  type Invite,
  type Message,
  type NonThreadGuildBasedChannel,
  type PartialGuildMember,
  type PartialMessage,
  type Role,
  type User,
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
  trackInvites: boolean;
  trackNicknameAvatar: boolean;
  trackMembership: boolean;
  trackUsernameChange: boolean;
  trackMemberRoles: boolean;
  trackRoleManagement: boolean;
  trackServerSettings: boolean;
  trackChannelManagement: boolean;
  trackModerationBans: boolean;
  trackTimeout: boolean;
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
    trackInvites: source.trackInvites === undefined ? true : source.trackInvites === true,
    trackNicknameAvatar:
      source.trackNicknameAvatar === undefined ? true : source.trackNicknameAvatar === true,
    trackMembership: source.trackMembership === undefined ? true : source.trackMembership === true,
    trackUsernameChange:
      source.trackUsernameChange === undefined ? true : source.trackUsernameChange === true,
    trackMemberRoles:
      source.trackMemberRoles === undefined ? true : source.trackMemberRoles === true,
    trackRoleManagement:
      source.trackRoleManagement === undefined ? true : source.trackRoleManagement === true,
    trackServerSettings:
      source.trackServerSettings === undefined ? true : source.trackServerSettings === true,
    trackChannelManagement:
      source.trackChannelManagement === undefined ? true : source.trackChannelManagement === true,
    trackModerationBans:
      source.trackModerationBans === undefined ? true : source.trackModerationBans === true,
    trackTimeout: source.trackTimeout === undefined ? true : source.trackTimeout === true,
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

/** Audit Logから操作の実行者を割引きで特定する(View Audit Log権限が無い・未確定の場合はnull)。 */
async function resolveAuditLogActorId(
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

  const authorId = message.author?.id ?? null;
  // Discordは本人による自己削除をAudit Logへ残さないため、実行者が解決できない場合は
  // 自己削除とみなし投稿者本人をactorとして扱う(他人の投稿を削除した場合は必ずAudit
  // Logに記録されるため、この前提は安全)。
  let actorId: string | null = null;
  let actorResolved = false;
  if (authorId && message.guild) {
    const resolved = await resolveAuditLogActorId(
      message.guild,
      AuditLogEvent.MessageDelete,
      authorId,
    );
    actorResolved = resolved !== null;
    actorId = resolved ?? authorId;
  }

  await record(context, {
    guildId: context.guildId,
    userId: actorId,
    event: 'message_delete',
    channelId: message.channelId,
    messageId: message.id,
    content: message.content ?? null,
    metadata: authorId ? { targetUserId: authorId, actorResolved } : null,
  });

  const userId = authorId;
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

  const actorId = await resolveAuditLogActorId(emoji.guild, auditLogEvent, emoji.id);
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

async function handleChannelEvent(
  context: ActivityLogRuntimeContext,
  event: 'channel_create' | 'channel_delete',
  auditLogEvent: AuditLogEvent,
  channel: DMChannel | NonThreadGuildBasedChannel,
): Promise<void> {
  if (!('guild' in channel) || !channel.guild) return;
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackChannelManagement) return;
  if (isExcludedChannel(config, channel.id)) return;

  const actorId = await resolveAuditLogActorId(channel.guild, auditLogEvent, channel.id);
  await record(context, {
    guildId: context.guildId,
    userId: actorId,
    event,
    channelId: channel.id,
    metadata: { channelName: channel.name, channelType: channel.type },
  });
}

/**
 * channelUpdateはトピック・権限上書き・スローモード等、名前以外の変更でも頻繁に発火する
 * (特にper-userの権限上書き)。ノイズを避けるため、guild_icon/banner_updateと同じ方針で
 * 名前の変更のみを記録対象とする。
 */
async function handleChannelUpdate(
  context: ActivityLogRuntimeContext,
  oldChannel: DMChannel | NonThreadGuildBasedChannel,
  newChannel: NonThreadGuildBasedChannel,
): Promise<void> {
  if (!('guild' in newChannel) || !newChannel.guild) return;
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackChannelManagement) return;
  if (isExcludedChannel(config, newChannel.id)) return;

  const oldName = 'name' in oldChannel ? oldChannel.name : null;
  if (oldName === newChannel.name) return;

  const actorId = await resolveAuditLogActorId(
    newChannel.guild,
    AuditLogEvent.ChannelUpdate,
    newChannel.id,
  );
  await record(context, {
    guildId: context.guildId,
    userId: actorId,
    event: 'channel_update',
    channelId: newChannel.id,
    metadata: { channelName: newChannel.name, before: oldName, after: newChannel.name },
  });
}

async function handleRoleEvent(
  context: ActivityLogRuntimeContext,
  event: 'guild_role_create' | 'guild_role_update' | 'guild_role_delete',
  auditLogEvent: AuditLogEvent,
  role: Role,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackRoleManagement) return;

  const actorId = await resolveAuditLogActorId(role.guild, auditLogEvent, role.id);
  await record(context, {
    guildId: context.guildId,
    userId: actorId,
    event,
    metadata: { roleId: role.id, roleName: role.name },
  });
}

async function handleMemberJoin(
  context: ActivityLogRuntimeContext,
  member: GuildMember,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackMembership || member.user.bot) return;

  await record(context, { guildId: context.guildId, userId: member.id, event: 'member_join' });
}

async function handleMemberLeave(
  context: ActivityLogRuntimeContext,
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackMembership || member.user.bot) return;

  await record(context, { guildId: context.guildId, userId: member.id, event: 'member_leave' });
}

async function handleBanEvent(
  context: ActivityLogRuntimeContext,
  event: 'member_ban' | 'member_unban',
  auditLogEvent: AuditLogEvent,
  ban: GuildBan,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackModerationBans) return;

  const actorId = await resolveAuditLogActorId(ban.guild, auditLogEvent, ban.user.id);
  await record(context, {
    guildId: context.guildId,
    userId: actorId,
    event,
    metadata: {
      targetUserId: ban.user.id,
      actorResolved: actorId !== null,
      reason: ban.reason ?? null,
    },
  });
}

async function handleInviteCreate(
  context: ActivityLogRuntimeContext,
  invite: Invite,
): Promise<void> {
  if (!invite.guild) return;
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackInvites) return;
  if (invite.inviter?.bot) return;

  await record(context, {
    guildId: context.guildId,
    userId: invite.inviter?.id ?? null,
    event: 'invite_create',
    channelId: invite.channelId ?? null,
    metadata: { code: invite.code, maxUses: invite.maxUses ?? null, maxAge: invite.maxAge ?? null },
  });
}

async function handleGuildMemberUpdate(
  context: ActivityLogRuntimeContext,
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || newMember.user.bot) return;
  const roleIds = [...newMember.roles.cache.keys()];
  if (hasExcludedRole(config, roleIds)) return;

  if (config.trackNicknameAvatar && oldMember.nickname !== newMember.nickname) {
    // Discordは本人によるニックネーム変更をAudit Logへ残さないため、実行者が解決
    // できない場合は自己変更とみなし対象メンバー本人をactorとして扱う。
    const actorId = await resolveAuditLogActorId(
      newMember.guild,
      AuditLogEvent.MemberUpdate,
      newMember.id,
    );
    await record(context, {
      guildId: context.guildId,
      userId: actorId ?? newMember.id,
      event: 'nickname_update',
      metadata: {
        before: oldMember.nickname,
        after: newMember.nickname,
        targetUserId: newMember.id,
        actorResolved: actorId !== null,
      },
    });
  }
  if (config.trackNicknameAvatar && oldMember.avatar !== newMember.avatar) {
    await record(context, {
      guildId: context.guildId,
      userId: newMember.id,
      event: 'avatar_update',
      metadata: { scope: 'guild' },
    });
  }

  if (config.trackTimeout) {
    const oldTimeout = oldMember.communicationDisabledUntilTimestamp ?? null;
    const newTimeout = newMember.communicationDisabledUntilTimestamp ?? null;
    const wasTimedOut = oldTimeout !== null && oldTimeout > Date.now();
    const isTimedOut = newTimeout !== null && newTimeout > Date.now();
    // 本人による自己タイムアウトは不可能なため、実行者が解決できない場合はnullのままとする。
    if (!wasTimedOut && isTimedOut) {
      const actorId = await resolveAuditLogActorId(
        newMember.guild,
        AuditLogEvent.MemberUpdate,
        newMember.id,
      );
      await record(context, {
        guildId: context.guildId,
        userId: actorId,
        event: 'member_timeout_add',
        metadata: {
          targetUserId: newMember.id,
          actorResolved: actorId !== null,
          until: newTimeout,
        },
      });
    } else if (wasTimedOut && !isTimedOut) {
      const actorId = await resolveAuditLogActorId(
        newMember.guild,
        AuditLogEvent.MemberUpdate,
        newMember.id,
      );
      await record(context, {
        guildId: context.guildId,
        userId: actorId,
        event: 'member_timeout_remove',
        metadata: { targetUserId: newMember.id, actorResolved: actorId !== null },
      });
    }
  }

  if (config.trackMemberRoles) {
    const oldRoleIds = new Set(oldMember.roles?.cache.keys() ?? []);
    const newRoleIds = new Set(roleIds);
    const addedRoleIds = [...newRoleIds].filter((roleId) => !oldRoleIds.has(roleId));
    const removedRoleIds = [...oldRoleIds].filter((roleId) => !newRoleIds.has(roleId));
    if (addedRoleIds.length > 0 || removedRoleIds.length > 0) {
      // セルフサービスロール・Bot付与等、本人以外が起点のケースが多いため「自己」固定の
      // フォールバックはせず、解決できなければ不明のままとする。
      const actorId = await resolveAuditLogActorId(
        newMember.guild,
        AuditLogEvent.MemberRoleUpdate,
        newMember.id,
      );
      for (const roleId of addedRoleIds) {
        await record(context, {
          guildId: context.guildId,
          userId: actorId,
          event: 'role_add',
          metadata: { roleId, targetUserId: newMember.id, actorResolved: actorId !== null },
        });
      }
      for (const roleId of removedRoleIds) {
        await record(context, {
          guildId: context.guildId,
          userId: actorId,
          event: 'role_remove',
          metadata: { roleId, targetUserId: newMember.id, actorResolved: actorId !== null },
        });
      }
    }
  }
}

async function handleUserProfileUpdate(
  context: ActivityLogRuntimeContext,
  oldUser: User,
  newUser: User,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || newUser.bot) return;

  if (config.trackNicknameAvatar && oldUser.avatar !== newUser.avatar) {
    await record(context, {
      guildId: context.guildId,
      userId: newUser.id,
      event: 'avatar_update',
      metadata: { scope: 'global' },
    });
  }
  if (
    config.trackUsernameChange &&
    (oldUser.username !== newUser.username || oldUser.globalName !== newUser.globalName)
  ) {
    await record(context, {
      guildId: context.guildId,
      userId: newUser.id,
      event: 'username_update',
      metadata: {
        beforeUsername: oldUser.username,
        afterUsername: newUser.username,
        beforeGlobalName: oldUser.globalName,
        afterGlobalName: newUser.globalName,
      },
    });
  }
}

async function handleGuildUpdate(
  context: ActivityLogRuntimeContext,
  oldGuild: Guild,
  newGuild: Guild,
): Promise<void> {
  const config = normalizeActivityLogConfig(context.config);
  if (!config.enabled || !config.trackServerSettings) return;

  if (oldGuild.name !== newGuild.name) {
    await record(context, {
      guildId: context.guildId,
      userId: null,
      event: 'guild_name_update',
      metadata: { before: oldGuild.name, after: newGuild.name },
    });
  }
  if (oldGuild.icon !== newGuild.icon) {
    await record(context, { guildId: context.guildId, userId: null, event: 'guild_icon_update' });
  }
  if (oldGuild.banner !== newGuild.banner) {
    await record(context, {
      guildId: context.guildId,
      userId: null,
      event: 'guild_banner_update',
    });
  }
}

// /activity-logのeventオプションのchoices（packages/plugin-catalog/src/manifests/activity-log.ts）
// と同じ日本語ラベルを使い、埋め込み表示でも生のevent値（例: voice_leave）を出さないようにする。
export const MEMBER_ACTIVITY_EVENT_LABELS: Record<MemberActivityEventType, string> = {
  voice_join: 'VC入室',
  voice_leave: 'VC退室',
  message_create: 'メッセージ作成',
  message_update: 'メッセージ編集',
  message_delete: 'メッセージ削除',
  emoji_create: '絵文字登録',
  emoji_update: '絵文字変更',
  emoji_delete: '絵文字削除',
  avatar_update: 'アバター変更',
  nickname_update: 'ニックネーム変更',
  role_add: 'ロール付与',
  role_remove: 'ロール剥奪',
  guild_icon_update: 'サーバーアイコン変更',
  guild_banner_update: 'サーバーバナー変更',
  channel_create: 'チャンネル作成',
  channel_delete: 'チャンネル削除',
  channel_update: 'チャンネル変更',
  guild_role_create: 'ロール作成',
  guild_role_update: 'ロール変更',
  guild_role_delete: 'ロール削除',
  member_join: 'サーバー参加',
  member_leave: 'サーバー退出',
  member_ban: 'BAN',
  member_unban: 'BAN解除',
  member_timeout_add: 'タイムアウト付与',
  member_timeout_remove: 'タイムアウト解除',
  guild_name_update: 'サーバー名変更',
  username_update: 'ユーザー名変更',
  invite_create: '招待リンク作成',
};

function describeEventMetadata(row: {
  event: MemberActivityEventType;
  metadata: Record<string, unknown> | null;
}): string {
  const metadata = row.metadata;
  if (!metadata) return '';
  const targetUserId = typeof metadata.targetUserId === 'string' ? metadata.targetUserId : null;
  const targetSuffix = targetUserId ? ` (対象: <@${targetUserId}>)` : '';

  if (row.event === 'nickname_update') {
    const before = typeof metadata.before === 'string' ? metadata.before : '(なし)';
    const after = typeof metadata.after === 'string' ? metadata.after : '(なし)';
    return ` — \`${before}\` → \`${after}\``;
  }
  if (row.event === 'role_add' || row.event === 'role_remove') {
    const roleId = typeof metadata.roleId === 'string' ? metadata.roleId : null;
    return `${roleId ? ` — <@&${roleId}>` : ''}${targetSuffix}`;
  }
  if (row.event === 'avatar_update') {
    return typeof metadata.scope === 'string'
      ? ` — (${metadata.scope === 'global' ? 'グローバル' : 'サーバー個別'})`
      : '';
  }
  if (
    row.event === 'channel_create' ||
    row.event === 'channel_delete' ||
    row.event === 'channel_update'
  ) {
    return typeof metadata.channelName === 'string' ? ` — \`#${metadata.channelName}\`` : '';
  }
  if (
    row.event === 'guild_role_create' ||
    row.event === 'guild_role_update' ||
    row.event === 'guild_role_delete'
  ) {
    const roleId = typeof metadata.roleId === 'string' ? metadata.roleId : null;
    return roleId ? ` — <@&${roleId}>` : '';
  }
  if (
    row.event === 'member_ban' ||
    row.event === 'member_unban' ||
    row.event === 'member_timeout_add' ||
    row.event === 'member_timeout_remove' ||
    row.event === 'message_delete'
  ) {
    return targetSuffix;
  }
  if (row.event === 'guild_name_update') {
    const before = typeof metadata.before === 'string' ? metadata.before : '(なし)';
    const after = typeof metadata.after === 'string' ? metadata.after : '(なし)';
    return ` — \`${before}\` → \`${after}\``;
  }
  if (row.event === 'username_update') {
    const beforeUsername =
      typeof metadata.beforeUsername === 'string' ? metadata.beforeUsername : null;
    const afterUsername =
      typeof metadata.afterUsername === 'string' ? metadata.afterUsername : null;
    return beforeUsername && afterUsername && beforeUsername !== afterUsername
      ? ` — \`${beforeUsername}\` → \`${afterUsername}\``
      : '';
  }
  if (row.event === 'invite_create') {
    return typeof metadata.code === 'string' ? ` — \`${metadata.code}\`` : '';
  }
  return '';
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
        : describeEventMetadata(row);
    return `${timestamp} **${MEMBER_ACTIVITY_EVENT_LABELS[row.event]}** ${who} ${where}${snippet}`;
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
      {
        event: 'guildMemberUpdate',
        async handler(_ctx, ...args) {
          await handleGuildMemberUpdate(
            context,
            args[0] as GuildMember | PartialGuildMember,
            args[1] as GuildMember,
          );
        },
      },
      {
        event: 'userProfileUpdate',
        async handler(_ctx, ...args) {
          await handleUserProfileUpdate(context, args[0] as User, args[1] as User);
        },
      },
      {
        event: 'guildUpdate',
        async handler(_ctx, ...args) {
          await handleGuildUpdate(context, args[0] as Guild, args[1] as Guild);
        },
      },
      {
        event: 'channelCreate',
        async handler(_ctx, ...args) {
          await handleChannelEvent(
            context,
            'channel_create',
            AuditLogEvent.ChannelCreate,
            args[0] as NonThreadGuildBasedChannel,
          );
        },
      },
      {
        event: 'channelDelete',
        async handler(_ctx, ...args) {
          await handleChannelEvent(
            context,
            'channel_delete',
            AuditLogEvent.ChannelDelete,
            args[0] as DMChannel | NonThreadGuildBasedChannel,
          );
        },
      },
      {
        event: 'channelUpdate',
        async handler(_ctx, ...args) {
          await handleChannelUpdate(
            context,
            args[0] as DMChannel | NonThreadGuildBasedChannel,
            args[1] as NonThreadGuildBasedChannel,
          );
        },
      },
      {
        event: 'guildRoleCreate',
        async handler(_ctx, ...args) {
          await handleRoleEvent(
            context,
            'guild_role_create',
            AuditLogEvent.RoleCreate,
            args[0] as Role,
          );
        },
      },
      {
        event: 'guildRoleUpdate',
        async handler(_ctx, ...args) {
          await handleRoleEvent(
            context,
            'guild_role_update',
            AuditLogEvent.RoleUpdate,
            args[1] as Role,
          );
        },
      },
      {
        event: 'guildRoleDelete',
        async handler(_ctx, ...args) {
          await handleRoleEvent(
            context,
            'guild_role_delete',
            AuditLogEvent.RoleDelete,
            args[0] as Role,
          );
        },
      },
      {
        event: 'guildMemberAdd',
        async handler(_ctx, ...args) {
          await handleMemberJoin(context, args[0] as GuildMember);
        },
      },
      {
        event: 'guildMemberRemove',
        async handler(_ctx, ...args) {
          await handleMemberLeave(context, args[0] as GuildMember | PartialGuildMember);
        },
      },
      {
        event: 'guildBanAdd',
        async handler(_ctx, ...args) {
          await handleBanEvent(
            context,
            'member_ban',
            AuditLogEvent.MemberBanAdd,
            args[0] as GuildBan,
          );
        },
      },
      {
        event: 'guildBanRemove',
        async handler(_ctx, ...args) {
          await handleBanEvent(
            context,
            'member_unban',
            AuditLogEvent.MemberBanRemove,
            args[0] as GuildBan,
          );
        },
      },
      {
        event: 'inviteCreate',
        async handler(_ctx, ...args) {
          await handleInviteCreate(context, args[0] as Invite);
        },
      },
    ];
  },
});
