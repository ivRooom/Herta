import type { PluginEventHandler, PluginRuntimeContext } from '@herta/plugin-sdk';
import { normalizeModerationConfig, type ModerationConfig } from './config.js';
import { recordModerationDetection } from './detection-history.js';
import { AutomaticModerationDetector, type AutomaticModerationFinding } from './detection.js';
import {
  isSeverityAtLeast,
  normalizeModerationEnforcementConfig,
  resolveAutomaticEnforcementPolicy,
  type AutomaticEnforcementAction,
  type AutomaticEnforcementPolicy,
  type AutomaticModerationSeverity,
} from './enforcement-config.js';
import {
  getActiveModerationBlacklistEntry,
  getModerationDetectionIdForFinding,
  hasActiveModerationBlacklistEntries,
  recordModerationAutomaticEventAudit,
  upsertModerationBlacklistEntry,
} from './enforcement-service.js';
import {
  createModerationCase,
  type ModerationCaseAction,
  type ModerationPrismaClient,
} from './service.js';
import {
  buildAutomaticAlertEmbed,
  buildAutomaticWarningEmbed,
  type DiscordVisualMessagePayload,
} from './discord-ui.js';

const KICK_MEMBERS_PERMISSION = 2n;
const BAN_MEMBERS_PERMISSION = 4n;
const MANAGE_MESSAGES_PERMISSION = 8192n;
const MANAGE_ROLES_PERMISSION = 268435456n;
const MODERATE_MEMBERS_PERMISSION = 1099511627776n;
const ALERT_EXCERPT_LENGTH = 400;

interface PermissionSet {
  has(permission: bigint): boolean;
}

interface ModerationMessageRoleCache {
  has(roleId: string): boolean;
}

interface ModerationRoleManager {
  cache: ModerationMessageRoleCache;
  highest: { position: number };
  add(roleId: string, reason?: string): Promise<unknown>;
}

interface ModerationAutomaticUser {
  id: string;
  bot: boolean;
  send(options: DiscordVisualMessagePayload): Promise<unknown>;
}

interface ModerationAutomaticMember {
  id: string;
  user: ModerationAutomaticUser;
  roles: ModerationRoleManager;
  moderatable?: boolean;
  kickable?: boolean;
  bannable?: boolean;
  timeout(durationMs: number, reason?: string): Promise<unknown>;
  kick(reason?: string): Promise<unknown>;
  ban(options?: { reason?: string; deleteMessageSeconds?: number }): Promise<unknown>;
}

interface ModerationTextChannel {
  isTextBased(): boolean;
  send(options: DiscordVisualMessagePayload): Promise<unknown>;
}

interface ModerationGuildRole {
  position: number;
}

interface ModerationAutomaticGuild {
  id: string;
  name: string;
  ownerId: string;
  members: {
    me: {
      id: string;
      permissions: PermissionSet;
      roles: { highest: { position: number } };
    } | null;
  };
  roles: { cache: { get(roleId: string): ModerationGuildRole | undefined } };
  channels: { cache: { get(channelId: string): ModerationTextChannel | undefined } };
}

interface ModerationMessage {
  id: string;
  guildId: string | null;
  guild: ModerationAutomaticGuild | null;
  channelId: string;
  content: string;
  createdTimestamp: number;
  webhookId: string | null;
  system: boolean;
  deletable?: boolean;
  author: ModerationAutomaticUser;
  member: ModerationAutomaticMember | null;
  mentions: {
    users: { size: number };
    roles: { size: number };
    everyone: boolean;
  };
  delete(): Promise<unknown>;
}

interface ModerationGuildMemberJoin {
  id: string;
  guild: ModerationAutomaticGuild;
  user: ModerationAutomaticUser;
  bannable?: boolean;
  ban(options?: { reason?: string; deleteMessageSeconds?: number }): Promise<unknown>;
}

interface ModerationClient {
  user?: { id: string } | null;
}

type ModerationAutomaticRuntimeContext = PluginRuntimeContext<
  ModerationConfig,
  unknown,
  ModerationPrismaClient
>;

type InsertedFinding = {
  finding: AutomaticModerationFinding;
  policy: AutomaticEnforcementPolicy;
  detectionId: string | null;
};

const detectors = new Map<string, AutomaticModerationDetector>();
// 現在の本番はBot単一プロセス構成。将来shard/複数process化する場合はRedis共有へ移行する。
const alertCooldowns = new Map<string, number>();

export function createModerationAutomaticEvents(
  context: ModerationAutomaticRuntimeContext,
): PluginEventHandler<ModerationConfig, unknown, ModerationPrismaClient>[] {
  const config = normalizeModerationConfig(context.config);
  const events: PluginEventHandler<ModerationConfig, unknown, ModerationPrismaClient>[] = [
    {
      event: 'guildMemberAdd',
      async handler(runtimeContext, ...args) {
        const member = args[0] as ModerationGuildMemberJoin | undefined;
        if (!member || member.guild.id !== runtimeContext.guildId) return;
        await enforceBlacklistOnJoin(runtimeContext, member);
      },
    },
  ];

  if (config.automaticMode === 'observe') {
    events.unshift({
      event: 'messageCreate',
      async handler(runtimeContext, ...args) {
        const message = args[0] as ModerationMessage | undefined;
        if (!message) return;
        await observeAutomaticModeration(runtimeContext, message);
      },
    });
  }

  return events;
}

export function resetModerationAutomaticDetector(guildId: string): void {
  detectors.get(guildId)?.clearGuild(guildId);
  detectors.delete(guildId);
  const prefix = `${guildId}:`;
  for (const key of alertCooldowns.keys()) {
    if (key.startsWith(prefix)) alertCooldowns.delete(key);
  }
}

async function observeAutomaticModeration(
  context: ModerationAutomaticRuntimeContext,
  message: ModerationMessage,
): Promise<void> {
  if (
    !message.guildId ||
    !message.guild ||
    message.guildId !== context.guildId ||
    message.author.bot ||
    message.webhookId ||
    message.system ||
    !message.content
  ) {
    return;
  }

  const config = normalizeModerationConfig(context.config);
  if (config.automaticMode !== 'observe') return;
  const enforcementConfig = normalizeModerationEnforcementConfig(context.config);

  const detector = getDetector(context.guildId);
  const roleIds = config.autoExemptRoleIds.filter((roleId) =>
    message.member?.roles.cache.has(roleId),
  );
  const findings = detector.evaluate(
    {
      guildId: context.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      roleIds,
      content: message.content,
      mentionCount:
        message.mentions.users.size +
        message.mentions.roles.size +
        (message.mentions.everyone ? 1 : 0),
      createdAtMs: message.createdTimestamp,
    },
    config,
  );
  if (findings.length === 0) return;

  const insertedFindings: InsertedFinding[] = [];
  for (const finding of findings) {
    logFinding(context, message, finding);
    try {
      const inserted = await recordModerationDetection(context.prisma, {
        guildId: context.guildId,
        messageId: message.id,
        channelId: message.channelId,
        userId: message.author.id,
        finding,
        occurredAt: new Date(message.createdTimestamp),
      });
      if (!inserted) continue;
      const policy = resolveAutomaticEnforcementPolicy(
        enforcementConfig.autoEnforcementPolicies,
        finding,
      );
      const detectionId = await getModerationDetectionIdForFinding(context.prisma, {
        guildId: context.guildId,
        messageId: message.id,
        finding,
      });
      insertedFindings.push({ finding, policy, detectionId });
    } catch (error) {
      context.logger.warn(
        {
          err: error,
          guildId: context.guildId,
          messageId: message.id,
          detectionKind: finding.kind,
        },
        'Moderation自動検知履歴の保存に失敗しました',
      );
    }
  }

  if (insertedFindings.length === 0) return;

  const alertFinding = selectHighestSeverity(insertedFindings);
  if (
    alertFinding &&
    enforcementConfig.autoAlertChannelId &&
    isSeverityAtLeast(alertFinding.policy.severity, enforcementConfig.autoAlertMinimumSeverity) &&
    shouldSendAlert(
      context.guildId,
      message.author.id,
      alertFinding.policy.selector,
      enforcementConfig.autoAlertCooldownSeconds,
    )
  ) {
    await sendUrgentAlert(context, message, alertFinding, insertedFindings, false).catch(
      (error) => {
        context.logger.warn(
          { err: error, guildId: context.guildId, messageId: message.id },
          'Moderation緊急Alertの送信に失敗しました',
        );
      },
    );
  }

  if (!enforcementConfig.autoEnforcementEnabled) return;
  const enforcement = selectStrongestEnforcement(insertedFindings);
  if (!enforcement || enforcement.policy.action === 'observe') return;

  await executeAutomaticEnforcement(context, message, enforcement, insertedFindings);
}

async function executeAutomaticEnforcement(
  context: ModerationAutomaticRuntimeContext,
  message: ModerationMessage,
  selected: InsertedFinding,
  allFindings: InsertedFinding[],
): Promise<void> {
  const actorId = getBotActorId(context.client);
  if (!actorId) {
    context.logger.error(
      { guildId: context.guildId },
      'Bot User IDを取得できず自動対応を中止しました',
    );
    return;
  }

  const reason = `自動検知ルール ${selected.policy.selector} に一致（危険度: ${selected.policy.severity}）`;
  const action = selected.policy.action;
  let actionError: unknown;

  try {
    assertAutomaticTargetCanBeModerated(message, selected.policy);
    if (action === 'blacklist') {
      await upsertModerationBlacklistEntry(context.prisma, {
        guildId: context.guildId,
        userId: message.author.id,
        reason,
        originDetectionId: selected.detectionId,
        createdBy: actorId,
      });
    }
    await executeAutomaticDiscordAction(message, selected.policy, reason);
  } catch (error) {
    actionError = error;
  }

  const caseAction = enforcementActionToCaseAction(action);
  if (caseAction) {
    try {
      const durationSeconds = action === 'timeout' ? selected.policy.timeoutMinutes * 60 : null;
      const expiresAt =
        durationSeconds === null ? null : new Date(Date.now() + durationSeconds * 1000);
      await createModerationCase(context.prisma, {
        guildId: context.guildId,
        action: caseAction,
        targetUserId: message.author.id,
        moderatorUserId: actorId,
        reason,
        status: actionError ? 'failed' : undefined,
        durationSeconds,
        expiresAt,
        source: 'automatic',
        originDetectionId: selected.detectionId,
      });
    } catch (error) {
      context.logger.error(
        {
          err: error,
          guildId: context.guildId,
          action,
          detectionId: selected.detectionId,
        },
        '自動Moderation Caseの記録に失敗しました',
      );
      if (!actionError) actionError = error;
    }
  }

  try {
    await recordModerationAutomaticEventAudit(context.prisma, {
      guildId: context.guildId,
      actorId,
      event: actionError ? 'moderation.automatic.failed' : 'moderation.automatic.executed',
      targetUserId: message.author.id,
      detectionId: selected.detectionId,
      metadata: {
        action,
        selector: selected.policy.selector,
        severity: selected.policy.severity,
        channelId: message.channelId,
        messageId: message.id,
      },
      severity: actionError || selected.policy.severity === 'critical' ? 'critical' : 'warning',
    });
  } catch (error) {
    context.logger.warn({ err: error }, '自動Moderation Audit Logの保存に失敗しました');
  }

  if (actionError) {
    context.logger.warn(
      {
        err: actionError,
        guildId: context.guildId,
        action,
        targetUserId: message.author.id,
      },
      '自動Moderation操作に失敗しました',
    );
    const enforcementConfig = normalizeModerationEnforcementConfig(context.config);
    if (
      enforcementConfig.autoAlertChannelId &&
      shouldSendAlert(
        context.guildId,
        message.author.id,
        `failed:${selected.policy.selector}`,
        enforcementConfig.autoAlertCooldownSeconds,
      )
    ) {
      await sendUrgentAlert(context, message, selected, allFindings, true, actionError).catch(
        (error) => {
          context.logger.warn({ err: error }, '自動Moderation失敗Alertの送信に失敗しました');
        },
      );
    }
  }
}

async function executeAutomaticDiscordAction(
  message: ModerationMessage,
  policy: AutomaticEnforcementPolicy,
  reason: string,
): Promise<void> {
  const member = message.member;
  switch (policy.action) {
    case 'observe':
      return;
    case 'warn':
      await sendAutomaticWarning(message, policy);
      return;
    case 'delete':
      await message.delete();
      return;
    case 'warn_delete': {
      await message.delete();
      await sendAutomaticWarning(message, policy);
      return;
    }
    case 'timeout':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.timeout(policy.timeoutMinutes * 60 * 1000, reason);
      return;
    case 'role':
      if (!member || !policy.roleId) throw new Error('付与対象ロールを取得できません');
      await member.roles.add(policy.roleId, reason);
      return;
    case 'blacklist':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.ban({ reason, deleteMessageSeconds: policy.banDeleteMessageSeconds });
      return;
    case 'kick':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.kick(reason);
      return;
    case 'ban':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.ban({ reason, deleteMessageSeconds: policy.banDeleteMessageSeconds });
  }
}

async function sendAutomaticWarning(
  message: ModerationMessage,
  policy: AutomaticEnforcementPolicy,
): Promise<void> {
  const content =
    policy.warningMessage ??
    'このサーバーでルール違反の可能性があるメッセージを検知しました。詳細はサーバーのモデレーターへお問い合わせください。';
  await message.author.send({
    embeds: [buildAutomaticWarningEmbed(policy, content)],
    allowedMentions: { parse: [] },
  });
}

function assertAutomaticTargetCanBeModerated(
  message: ModerationMessage,
  policy: AutomaticEnforcementPolicy,
): void {
  const guild = message.guild;
  if (!guild) throw new Error('Guild情報を取得できません');
  if (message.author.id === guild.ownerId) throw new Error('Guild Ownerは自動対応対象にできません');
  if (message.author.bot) throw new Error('Botアカウントは自動対応対象にできません');

  const bot = guild.members.me;
  if (!bot) throw new Error('BotのGuild Member情報を取得できません');
  if (message.author.id === bot.id) throw new Error('Herta Bot自身は自動対応対象にできません');

  const action = policy.action;
  if (
    (action === 'delete' || action === 'warn_delete') &&
    !bot.permissions.has(MANAGE_MESSAGES_PERMISSION)
  ) {
    throw new Error('Botにメッセージ管理権限がありません');
  }
  if ((action === 'delete' || action === 'warn_delete') && message.deletable === false) {
    throw new Error('対象メッセージを削除できません');
  }
  if (
    action === 'warn' ||
    action === 'delete' ||
    action === 'warn_delete' ||
    action === 'observe'
  ) {
    return;
  }

  const member = message.member;
  if (!member) throw new Error('対象Guild Memberを取得できません');
  if (bot.roles.highest.position <= member.roles.highest.position) {
    throw new Error('対象ユーザーのロールがBot以上のため自動対応できません');
  }

  if (action === 'timeout') {
    if (!bot.permissions.has(MODERATE_MEMBERS_PERMISSION) || member.moderatable === false) {
      throw new Error('対象ユーザーをTimeoutできません');
    }
    return;
  }
  if (action === 'kick') {
    if (!bot.permissions.has(KICK_MEMBERS_PERMISSION) || member.kickable === false) {
      throw new Error('対象ユーザーをKickできません');
    }
    return;
  }
  if (action === 'ban' || action === 'blacklist') {
    if (!bot.permissions.has(BAN_MEMBERS_PERMISSION) || member.bannable === false) {
      throw new Error('対象ユーザーをBANできません');
    }
    return;
  }
  if (action === 'role') {
    if (!bot.permissions.has(MANAGE_ROLES_PERMISSION))
      throw new Error('Botにロール管理権限がありません');
    if (!policy.roleId) throw new Error('付与ロールIDが未設定です');
    const role = guild.roles.cache.get(policy.roleId);
    if (!role) throw new Error('付与ロールが見つかりません');
    if (bot.roles.highest.position <= role.position) {
      throw new Error('Bot以上のロールは自動付与できません');
    }
  }
}

async function sendUrgentAlert(
  context: ModerationAutomaticRuntimeContext,
  message: ModerationMessage,
  selected: InsertedFinding,
  findings: InsertedFinding[],
  failure: boolean,
  error?: unknown,
): Promise<void> {
  const config = normalizeModerationEnforcementConfig(context.config);
  const channelId = config.autoAlertChannelId;
  if (!channelId || !message.guild) return;
  const channel = message.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) throw new Error('緊急Alertチャンネルが見つかりません');

  const jumpUrl = `https://discord.com/channels/${context.guildId}/${message.channelId}/${message.id}`;
  const mentionPrefix = config.autoAlertMentionRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');
  const embed = buildAutomaticAlertEmbed({
    severity: selected.policy.severity,
    action: selected.policy.action,
    targetUserId: message.author.id,
    channelId: message.channelId,
    matchedSelectors: findings.map((item) => item.policy.selector),
    jumpUrl,
    createdTimestamp: message.createdTimestamp,
    excerpt: config.autoAlertIncludeExcerpt ? sanitizeExcerpt(message.content) : null,
    failure,
    errorMessage: failure ? formatError(error) : null,
  });

  await channel.send({
    ...(mentionPrefix ? { content: mentionPrefix } : {}),
    embeds: [embed],
    allowedMentions: { parse: [], roles: config.autoAlertMentionRoleIds },
  });
}

async function enforceBlacklistOnJoin(
  context: ModerationAutomaticRuntimeContext,
  member: ModerationGuildMemberJoin,
): Promise<void> {
  if (member.user.bot) return;
  if (!(await hasActiveModerationBlacklistEntries(context.prisma, context.guildId))) return;
  const entry = await getActiveModerationBlacklistEntry(context.prisma, context.guildId, member.id);
  if (!entry) return;
  const actorId = getBotActorId(context.client);
  if (!actorId) {
    context.logger.error(
      { guildId: context.guildId, targetUserId: member.id },
      'Bot User IDを取得できずブラックリスト再参加BANを中止しました',
    );
    return;
  }
  const reason = entry.reason ?? 'Hertaブラックリストに登録されています';
  try {
    if (member.bannable === false) throw new Error('対象ユーザーをBANできません');
    await member.ban({ reason });
  } catch (error) {
    context.logger.error(
      { err: error, guildId: context.guildId, targetUserId: member.id },
      'ブラックリスト対象ユーザーの再参加BANに失敗しました',
    );
    return;
  }

  try {
    await recordModerationAutomaticEventAudit(context.prisma, {
      guildId: context.guildId,
      actorId,
      event: 'moderation.blacklist.rejoin_ban',
      targetUserId: member.id,
      detectionId: entry.originDetectionId,
      metadata: { blacklistCreatedAt: entry.createdAt.toISOString() },
      severity: 'critical',
    });
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: context.guildId, targetUserId: member.id },
      '再参加BANのAudit Log保存に失敗しました',
    );
  }
}

function selectHighestSeverity(findings: InsertedFinding[]): InsertedFinding | null {
  return (
    [...findings].sort(
      (a, b) => severityRank(b.policy.severity) - severityRank(a.policy.severity),
    )[0] ?? null
  );
}

function selectStrongestEnforcement(findings: InsertedFinding[]): InsertedFinding | null {
  return (
    [...findings].sort((a, b) => {
      const actionDifference = actionRank(b.policy.action) - actionRank(a.policy.action);
      if (actionDifference !== 0) return actionDifference;
      return severityRank(b.policy.severity) - severityRank(a.policy.severity);
    })[0] ?? null
  );
}

function actionRank(action: AutomaticEnforcementAction): number {
  return {
    observe: 0,
    warn: 1,
    delete: 2,
    warn_delete: 3,
    role: 4,
    timeout: 5,
    kick: 6,
    ban: 7,
    blacklist: 8,
  }[action];
}

function severityRank(severity: AutomaticModerationSeverity): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[severity];
}

function enforcementActionToCaseAction(
  action: AutomaticEnforcementAction,
): ModerationCaseAction | null {
  return action === 'observe' ? null : action;
}

function shouldSendAlert(
  guildId: string,
  userId: string,
  selector: string,
  cooldownSeconds: number,
): boolean {
  if (cooldownSeconds <= 0) return true;
  const key = `${guildId}:${userId}:${selector}`;
  const now = Date.now();
  const previous = alertCooldowns.get(key) ?? 0;
  if (now - previous < cooldownSeconds * 1000) return false;
  alertCooldowns.set(key, now);
  if (alertCooldowns.size > 10_000) {
    const threshold = now - Math.max(cooldownSeconds, 60) * 1000;
    for (const [candidate, at] of alertCooldowns) {
      if (at < threshold) alertCooldowns.delete(candidate);
    }
    while (alertCooldowns.size > 10_000) {
      const oldestKey = alertCooldowns.keys().next().value as string | undefined;
      if (!oldestKey) break;
      alertCooldowns.delete(oldestKey);
    }
  }
  return true;
}

function getDetector(guildId: string): AutomaticModerationDetector {
  const existing = detectors.get(guildId);
  if (existing) return existing;
  const detector = new AutomaticModerationDetector();
  detectors.set(guildId, detector);
  return detector;
}

function logFinding(
  context: ModerationAutomaticRuntimeContext,
  message: ModerationMessage,
  finding: AutomaticModerationFinding,
): void {
  context.logger.info(
    {
      guildId: context.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      mode: 'observe',
      detectionKind: finding.kind,
      messageLength: finding.messageLength,
      observedCount: finding.observedCount,
      threshold: finding.threshold,
      ruleIndex: finding.ruleIndex,
    },
    'Moderation自動検知のobserveイベントを記録しました',
  );
}

function getBotActorId(client: unknown): string | null {
  if (typeof client !== 'object' || client === null || !('user' in client)) return null;
  const user = (client as ModerationClient).user;
  return typeof user?.id === 'string' && /^\d+$/.test(user.id) ? user.id : null;
}

function sanitizeExcerpt(content: string): string {
  return content.replace(/```/gu, "''' ").slice(0, ALERT_EXCERPT_LENGTH);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return String(error ?? 'UnknownError').slice(0, 300);
}
