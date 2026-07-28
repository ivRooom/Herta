import { definePlugin } from '@herta/plugin-sdk';
import type { CommandHandler, PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  ModerationValidationError,
  normalizeDeleteMessageSeconds,
  normalizeModerationConfig,
  normalizeModerationReason,
  normalizeTimeoutMinutes,
  type ModerationConfig,
} from './config.js';
import { moderationManifest } from './manifest.js';
import {
  createModerationCase,
  getModerationCase,
  listModerationCases,
  type ModerationAction,
  type ModerationCaseRecord,
  type ModerationPrismaClient,
} from './service.js';

const EPHEMERAL_FLAG = 64;
const KICK_MEMBERS_PERMISSION = 2n;
const BAN_MEMBERS_PERMISSION = 4n;
const MANAGE_MESSAGES_PERMISSION = 8192n;
const MODERATE_MEMBERS_PERMISSION = 1099511627776n;
const MAX_RESPONSE_LENGTH = 1900;
const HISTORY_PAGE_SIZE = 5;

interface PermissionSet {
  has(permission: bigint): boolean;
}

interface RoleCache {
  has(roleId: string): boolean;
}

interface ModerationUser {
  id: string;
  username: string;
  globalName?: string | null;
  bot?: boolean;
  send(options: ModerationReplyOptions): Promise<unknown>;
}

interface ModerationMember {
  id: string;
  user: ModerationUser;
  permissions: PermissionSet;
  roles: {
    highest: { position: number };
    cache: RoleCache;
  };
  moderatable?: boolean;
  kickable?: boolean;
  bannable?: boolean;
  timeout(durationMs: number, reason?: string): Promise<unknown>;
  kick(reason?: string): Promise<unknown>;
  ban(options?: { reason?: string; deleteMessageSeconds?: number }): Promise<unknown>;
}

interface TextChannel {
  isTextBased(): boolean;
  send(options: ModerationReplyOptions): Promise<unknown>;
}

interface ModerationGuild {
  ownerId: string;
  members: { me: ModerationMember | null };
  channels: { cache: { get(channelId: string): TextChannel | undefined } };
}

interface ModerationCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
  getMember(name: string): ModerationMember | null;
  getUser(name: string, required?: boolean): ModerationUser | null;
}

interface ModerationCommandInteraction {
  guildId: string | null;
  guild: ModerationGuild | null;
  user: ModerationUser;
  member: ModerationMember | null;
  memberPermissions: PermissionSet | null;
  options: ModerationCommandOptions;
  replied: boolean;
  deferred: boolean;
  reply(options: ModerationReplyOptions): Promise<unknown>;
  followUp(options: ModerationReplyOptions): Promise<unknown>;
}

interface ModerationReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

type ModerationRuntimeContext = PluginRuntimeContext<
  ModerationConfig,
  unknown,
  ModerationPrismaClient
>;

export const moderationPlugin = definePlugin<ModerationConfig, unknown, ModerationPrismaClient>({
  manifest: moderationManifest,

  async onEnable(context) {
    context.logger.info('Moderation Plugin v1を有効化しました');
  },

  async onDisable(context) {
    context.logger.info('Moderation Plugin v1を無効化しました');
  },

  provideCommands(context) {
    const command: CommandHandler<ModerationCommandInteraction> = {
      definition: moderationManifest.commands[0]!,
      async execute(interaction) {
        await executeModerationCommand(context, interaction);
      },
    };
    return [command];
  },
});

async function executeModerationCommand(
  context: ModerationRuntimeContext,
  interaction: ModerationCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guildId || !guild || !interaction.member) {
    await respond(interaction, 'このコマンドはサーバー内でのみ利用できます', true);
    return;
  }

  const config = normalizeModerationConfig(context.config);
  const subcommand = interaction.options.getSubcommand();

  try {
    assertAllowedModerator(interaction, config);

    if (subcommand === 'case') {
      assertAnyPermission(interaction, [MANAGE_MESSAGES_PERMISSION, MODERATE_MEMBERS_PERMISSION]);
      const caseNumber = requiredInteger(interaction, 'number');
      const moderationCase = await getModerationCase(context.prisma, guildId, caseNumber);
      await respond(
        interaction,
        moderationCase ? formatCase(moderationCase) : `Case #${caseNumber} は見つかりません`,
        config.defaultResponseEphemeral,
      );
      return;
    }

    if (subcommand === 'history') {
      assertAnyPermission(interaction, [MANAGE_MESSAGES_PERMISSION, MODERATE_MEMBERS_PERMISSION]);
      const target = requiredUser(interaction, 'user');
      const result = await listModerationCases(context.prisma, {
        guildId,
        targetUserId: target.id,
        page: interaction.options.getInteger('page') ?? 1,
        pageSize: HISTORY_PAGE_SIZE,
      });
      await respond(
        interaction,
        formatHistory(target.id, result.items, result.page, result.totalPages),
        config.defaultResponseEphemeral,
      );
      return;
    }

    const action = normalizeAction(subcommand);
    assertActionPermission(interaction, action);
    const target = requiredMember(interaction, 'user');
    assertTargetCanBeModerated(interaction, guild, target, action);
    const reason = normalizeModerationReason(interaction.options.getString('reason'), config);

    const durationMinutes =
      action === 'timeout'
        ? normalizeTimeoutMinutes(requiredInteger(interaction, 'duration'))
        : null;
    const durationSeconds = durationMinutes === null ? null : durationMinutes * 60;
    const expiresAt =
      durationSeconds === null ? null : new Date(Date.now() + durationSeconds * 1000);
    const deleteMessageSeconds =
      action === 'ban'
        ? normalizeDeleteMessageSeconds(interaction.options.getInteger('delete_message_seconds'))
        : 0;

    try {
      await executeDiscordAction(action, target, reason, durationMinutes, deleteMessageSeconds);
    } catch (error) {
      await recordFailedCase(context, {
        guildId,
        action,
        target,
        moderatorUserId: interaction.user.id,
        reason,
        durationSeconds,
        expiresAt,
      });
      context.logger.warn(
        { err: error, guildId, action, targetUserId: target.id },
        'Discordモデレーション操作に失敗しました',
      );
      await respond(
        interaction,
        'Discord上の操作に失敗しました。Bot権限とロール階層を確認してください',
        true,
      );
      return;
    }

    const moderationCase = await createModerationCase(context.prisma, {
      guildId,
      action,
      targetUserId: target.id,
      moderatorUserId: interaction.user.id,
      reason,
      durationSeconds,
      expiresAt,
      source: 'discord',
    });

    if (config.dmTarget) {
      await notifyTarget(context, target.user, moderationCase);
    }
    if (config.logChannelId) {
      await sendModerationLog(context, guild, config.logChannelId, moderationCase);
    }

    await respond(
      interaction,
      `Case #${moderationCase.caseNumber} として${actionLabel(action)}を記録しました`,
      config.defaultResponseEphemeral,
    );
  } catch (error) {
    if (error instanceof ModerationValidationError) {
      await respond(interaction, error.message, true);
      return;
    }

    context.logger.error(
      { err: error, guildId, userId: interaction.user.id, subcommand },
      'Moderation Commandの実行に失敗しました',
    );
    await respond(interaction, 'Moderation Commandの実行中にエラーが発生しました', true);
  }
}

async function executeDiscordAction(
  action: ModerationAction,
  target: ModerationMember,
  reason: string | null,
  durationMinutes: number | null,
  deleteMessageSeconds: number,
): Promise<void> {
  switch (action) {
    case 'warn':
      return;
    case 'timeout':
      await target.timeout((durationMinutes ?? 0) * 60 * 1000, reason ?? undefined);
      return;
    case 'kick':
      await target.kick(reason ?? undefined);
      return;
    case 'ban':
      await target.ban({
        reason: reason ?? undefined,
        deleteMessageSeconds,
      });
  }
}

async function recordFailedCase(
  context: ModerationRuntimeContext,
  input: {
    guildId: string;
    action: ModerationAction;
    target: ModerationMember;
    moderatorUserId: string;
    reason: string | null;
    durationSeconds: number | null;
    expiresAt: Date | null;
  },
): Promise<void> {
  try {
    await createModerationCase(context.prisma, {
      guildId: input.guildId,
      action: input.action,
      targetUserId: input.target.id,
      moderatorUserId: input.moderatorUserId,
      reason: input.reason,
      status: 'failed',
      durationSeconds: input.durationSeconds,
      expiresAt: input.expiresAt,
      source: 'discord',
    });
  } catch (error) {
    context.logger.error(
      { err: error, guildId: input.guildId, action: input.action },
      '失敗したモデレーション操作のケース記録にも失敗しました',
    );
  }
}

function assertAllowedModerator(
  interaction: ModerationCommandInteraction,
  config: ModerationConfig,
): void {
  if (config.allowedModeratorRoleIds.length === 0) return;
  const member = interaction.member;
  if (!member || !config.allowedModeratorRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
    throw new ModerationValidationError('このコマンドを実行できるロールがありません');
  }
}

function assertActionPermission(
  interaction: ModerationCommandInteraction,
  action: ModerationAction,
): void {
  switch (action) {
    case 'warn':
      assertAnyPermission(interaction, [MANAGE_MESSAGES_PERMISSION, MODERATE_MEMBERS_PERMISSION]);
      return;
    case 'timeout':
      assertAnyPermission(interaction, [MODERATE_MEMBERS_PERMISSION]);
      return;
    case 'kick':
      assertAnyPermission(interaction, [KICK_MEMBERS_PERMISSION]);
      return;
    case 'ban':
      assertAnyPermission(interaction, [BAN_MEMBERS_PERMISSION]);
  }
}

function assertAnyPermission(
  interaction: ModerationCommandInteraction,
  permissions: bigint[],
): void {
  if (!interaction.memberPermissions || !permissions.some((value) => interaction.memberPermissions!.has(value))) {
    throw new ModerationValidationError('この操作を実行するDiscord権限がありません');
  }
}

function assertTargetCanBeModerated(
  interaction: ModerationCommandInteraction,
  guild: ModerationGuild,
  target: ModerationMember,
  action: ModerationAction,
): void {
  const actor = interaction.member;
  const bot = guild.members.me;
  if (!actor || !bot) throw new ModerationValidationError('BotのGuildメンバー情報を取得できません');
  if (target.id === guild.ownerId) throw new ModerationValidationError('Guild Ownerは対象にできません');
  if (target.id === interaction.user.id) throw new ModerationValidationError('自分自身は対象にできません');
  if (target.id === bot.id) throw new ModerationValidationError('Herta Bot自身は対象にできません');
  if (target.user.bot) throw new ModerationValidationError('Botアカウントは対象にできません');
  if (actor.roles.highest.position <= target.roles.highest.position) {
    throw new ModerationValidationError('自分と同等以上のロールを持つユーザーは対象にできません');
  }
  if (bot.roles.highest.position <= target.roles.highest.position) {
    throw new ModerationValidationError('Botより上位のロールを持つユーザーは対象にできません');
  }

  const botPermission = permissionForAction(action);
  if (botPermission !== null && !bot.permissions.has(botPermission)) {
    throw new ModerationValidationError('Botに必要なDiscord権限がありません');
  }
  if (action === 'timeout' && target.moderatable === false) {
    throw new ModerationValidationError('対象ユーザーをタイムアウトできません');
  }
  if (action === 'kick' && target.kickable === false) {
    throw new ModerationValidationError('対象ユーザーをKickできません');
  }
  if (action === 'ban' && target.bannable === false) {
    throw new ModerationValidationError('対象ユーザーをBANできません');
  }
}

function permissionForAction(action: ModerationAction): bigint | null {
  if (action === 'timeout') return MODERATE_MEMBERS_PERMISSION;
  if (action === 'kick') return KICK_MEMBERS_PERMISSION;
  if (action === 'ban') return BAN_MEMBERS_PERMISSION;
  return null;
}

async function notifyTarget(
  context: ModerationRuntimeContext,
  user: ModerationUser,
  moderationCase: ModerationCaseRecord,
): Promise<void> {
  try {
    await user.send({
      content: formatTargetNotification(moderationCase),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    context.logger.info(
      { err: error, caseNumber: moderationCase.caseNumber, targetUserId: user.id },
      '対象ユーザーへのDM通知をスキップしました',
    );
  }
}

async function sendModerationLog(
  context: ModerationRuntimeContext,
  guild: ModerationGuild,
  channelId: string,
  moderationCase: ModerationCaseRecord,
): Promise<void> {
  try {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error('ログチャンネルが見つかりません');
    await channel.send({
      content: formatCase(moderationCase),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    context.logger.warn(
      { err: error, caseNumber: moderationCase.caseNumber, channelId },
      'モデレーションログの送信に失敗しました',
    );
  }
}

function formatCase(moderationCase: ModerationCaseRecord): string {
  const lines = [
    `**Moderation Case #${moderationCase.caseNumber}**`,
    `種別: ${actionLabel(moderationCase.action)}`,
    `状態: ${statusLabel(moderationCase.status)}`,
    `対象: ${moderationCase.targetUserId}`,
    `実行者: ${moderationCase.moderatorUserId}`,
  ];
  if (moderationCase.durationSeconds) {
    lines.push(`期間: ${Math.ceil(moderationCase.durationSeconds / 60)}分`);
  }
  if (moderationCase.reason) lines.push(`理由: ${moderationCase.reason}`);
  lines.push(`作成日時: ${moderationCase.createdAt.toISOString()}`);
  return truncate(lines.join('\n'), MAX_RESPONSE_LENGTH);
}

function formatHistory(
  targetUserId: string,
  items: ModerationCaseRecord[],
  page: number,
  totalPages: number,
): string {
  if (items.length === 0) return `ユーザー ${targetUserId} のケースはありません`;
  const body = items
    .map((item) => {
      const reason = item.reason ? ` — ${truncate(item.reason, 120)}` : '';
      return `**#${item.caseNumber}** ${actionLabel(item.action)} / ${statusLabel(item.status)}${reason}`;
    })
    .join('\n');
  return truncate(`ユーザー ${targetUserId} の履歴 (${page}/${totalPages})\n\n${body}`, MAX_RESPONSE_LENGTH);
}

function formatTargetNotification(moderationCase: ModerationCaseRecord): string {
  const lines = [
    `このサーバーで${actionLabel(moderationCase.action)}が実行されました。`,
    `Case: #${moderationCase.caseNumber}`,
  ];
  if (moderationCase.reason) lines.push(`理由: ${moderationCase.reason}`);
  if (moderationCase.durationSeconds) {
    lines.push(`期間: ${Math.ceil(moderationCase.durationSeconds / 60)}分`);
  }
  return truncate(lines.join('\n'), MAX_RESPONSE_LENGTH);
}

function actionLabel(action: ModerationAction): string {
  const labels: Record<ModerationAction, string> = {
    warn: '警告',
    timeout: 'タイムアウト',
    kick: 'Kick',
    ban: 'BAN',
  };
  return labels[action];
}

function statusLabel(status: ModerationCaseRecord['status']): string {
  const labels: Record<ModerationCaseRecord['status'], string> = {
    active: '有効',
    completed: '完了',
    revoked: '解除済み',
    failed: '失敗',
  };
  return labels[status];
}

function normalizeAction(value: string): ModerationAction {
  if (value === 'warn' || value === 'timeout' || value === 'kick' || value === 'ban') return value;
  throw new ModerationValidationError('指定されたサブコマンドは利用できません');
}

function requiredMember(
  interaction: ModerationCommandInteraction,
  name: string,
): ModerationMember {
  const member = interaction.options.getMember(name);
  if (!member) throw new ModerationValidationError('対象ユーザーがサーバー内に見つかりません');
  return member;
}

function requiredUser(interaction: ModerationCommandInteraction, name: string): ModerationUser {
  const user = interaction.options.getUser(name, true);
  if (!user) throw new ModerationValidationError('対象ユーザーを指定してください');
  return user;
}

function requiredInteger(interaction: ModerationCommandInteraction, name: string): number {
  const value = interaction.options.getInteger(name, true);
  if (value === null) throw new ModerationValidationError(`${name}を入力してください`);
  return value;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

async function respond(
  interaction: ModerationCommandInteraction,
  content: string,
  ephemeral: boolean,
): Promise<void> {
  const options: ModerationReplyOptions = {
    content: truncate(content, MAX_RESPONSE_LENGTH),
    allowedMentions: { parse: [] },
    ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}

export default moderationPlugin;
