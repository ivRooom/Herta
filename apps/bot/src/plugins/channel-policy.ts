import { channelPolicyManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';

export type ChannelPolicyMode =
  | 'commands_only'
  | 'media_only'
  | 'images_only'
  | 'videos_only'
  | 'attachments_only'
  | 'text_only'
  | 'links_only'
  | 'no_links';

export type ChannelPolicyAction = 'log_only' | 'delete' | 'warn_delete';

export interface ChannelPolicyRule {
  enabled: boolean;
  channelId: string;
  mode: ChannelPolicyMode;
  action: ChannelPolicyAction;
  allowCaption: boolean;
  allowStickers: boolean;
  includeThreads: boolean;
  exemptRoleIds: string[];
  exemptUserIds: string[];
  warningMessage: string | null;
}

export interface ChannelPolicyConfig {
  enabled: boolean;
  warningCooldownSeconds: number;
  defaultWarningMessage: string;
  rules: ChannelPolicyRule[];
}

interface ChannelPolicyAttachment {
  contentType?: string | null;
  name?: string | null;
}

interface ChannelPolicyRoleCache {
  has(roleId: string): boolean;
}

interface ChannelPolicyMessage {
  id: string;
  guildId: string | null;
  channelId: string;
  content: string;
  webhookId: string | null;
  system: boolean;
  deletable?: boolean;
  author: {
    id: string;
    bot: boolean;
  };
  member: {
    roles: {
      cache: ChannelPolicyRoleCache;
    };
  } | null;
  attachments: {
    size: number;
    values(): IterableIterator<ChannelPolicyAttachment>;
  };
  stickers: {
    size: number;
  };
  channel: {
    parentId?: string | null;
    isThread?(): boolean;
    isTextBased(): boolean;
    send(options: { content: string; allowedMentions: { parse: [] } }): Promise<unknown>;
  };
  delete(): Promise<unknown>;
}

export interface ChannelPolicyEvaluation {
  allowed: boolean;
  reason: string | null;
}

type ChannelPolicyRuntimeContext = PluginRuntimeContext<ChannelPolicyConfig>;

const DEFAULT_WARNING =
  '{user} このチャンネルでは `{mode}` ルールが有効です。投稿内容を確認してください。';
const DISCORD_ID_PATTERN = /^\d+$/;
const URL_PATTERN = /https?:\/\/[^\s<>]+/giu;
const DISCORD_WRAPPED_URL_PATTERN = /<https?:\/\/[^\s<>]+>/giu;
const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'webp',
]);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm']);
const MODES = new Set<ChannelPolicyMode>([
  'commands_only',
  'media_only',
  'images_only',
  'videos_only',
  'attachments_only',
  'text_only',
  'links_only',
  'no_links',
]);
const ACTIONS = new Set<ChannelPolicyAction>(['log_only', 'delete', 'warn_delete']);
const MAX_WARNING_COOLDOWNS = 5000;
const warningCooldowns = new Map<string, number>();

export const channelPolicyPlugin = definePlugin<ChannelPolicyConfig>({
  manifest: channelPolicyManifest,
  async onEnable(context) {
    if (!channelPolicyMessageContentIntentEnabled()) {
      throw new Error(
        'Channel PolicyにはDISCORD_ENABLE_MESSAGE_CONTENT_INTENT=trueとDiscord Developer PortalのMessage Content Intent有効化が必要です',
      );
    }
    context.logger.info('Channel PolicyのMessage Content Intent要件を確認しました');
  },
  provideEvents(context) {
    return createChannelPolicyEvents(context.guildId) as PluginEventHandler<ChannelPolicyConfig>[];
  },
  async onDisable(context) {
    resetChannelPolicyRuntime(context.guildId);
  },
});

function createChannelPolicyEvents(guildId: string): PluginEventHandler<ChannelPolicyConfig>[] {
  return [
    {
      event: 'messageCreate',
      async handler(context, ...args) {
        const message = args[0] as ChannelPolicyMessage | undefined;
        await enforceChannelPolicyMessage(context, guildId, message);
      },
    },
    {
      event: 'messageUpdate',
      async handler(context, ...args) {
        const updatedMessage = args[1] as ChannelPolicyMessage | undefined;
        await enforceChannelPolicyMessage(context, guildId, updatedMessage);
      },
    },
  ];
}

async function enforceChannelPolicyMessage(
  context: ChannelPolicyRuntimeContext,
  guildId: string,
  message: ChannelPolicyMessage | undefined,
): Promise<void> {
  if (!message || message.guildId !== guildId || message.guildId !== context.guildId) return;
  if (!message.author || !message.channel || !message.attachments || !message.stickers) return;
  if (typeof message.content !== 'string') return;
  if (message.author.bot || message.webhookId || message.system) return;

  const config = normalizeChannelPolicyConfig(context.config);
  if (!config.enabled || config.rules.length === 0) return;

  const rule = findChannelPolicyRule(
    config,
    message.channelId,
    message.channel.parentId ?? null,
    message.channel.isThread?.() === true,
  );
  if (!rule || !rule.enabled || isExempt(message, rule)) return;

  const evaluation = evaluateChannelPolicyMessage(message, rule);
  if (evaluation.allowed) return;

  const logContext = {
    guildId: context.guildId,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    policyChannelId: rule.channelId,
    mode: rule.mode,
    action: rule.action,
    reason: evaluation.reason,
  };

  if (rule.action === 'log_only') {
    context.logger.info(logContext, 'Channel Policy違反を検知しました');
    return;
  }

  let deleted = false;
  if (message.deletable === false) {
    context.logger.warn(
      logContext,
      'Channel Policy違反メッセージを削除できません。Bot権限を確認してください',
    );
  } else {
    try {
      await message.delete();
      deleted = true;
      context.logger.info(logContext, 'Channel Policy違反メッセージを削除しました');
    } catch (error) {
      context.logger.warn(
        { ...logContext, err: error },
        'Channel Policy違反メッセージの削除に失敗しました',
      );
    }
  }

  if (rule.action !== 'warn_delete') return;
  if (!message.channel.isTextBased()) return;
  if (
    !shouldSendChannelPolicyWarning(
      context.guildId,
      message.channelId,
      message.author.id,
      config.warningCooldownSeconds,
    )
  ) {
    return;
  }

  const warning = formatChannelPolicyWarning(
    rule.warningMessage ?? config.defaultWarningMessage,
    message,
    rule,
  );
  try {
    await message.channel.send({
      content: warning,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    context.logger.warn(
      { ...logContext, err: error, deleted },
      'Channel Policy警告メッセージの送信に失敗しました',
    );
  }
}

export function channelPolicyMessageContentIntentEnabled(
  value = process.env['DISCORD_ENABLE_MESSAGE_CONTENT_INTENT'],
): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

export function normalizeChannelPolicyConfig(value: unknown): ChannelPolicyConfig {
  const source = isRecord(value) ? value : {};
  const warningCooldownSeconds = clampInteger(source.warningCooldownSeconds, 15, 0, 3600);
  const defaultWarningMessage =
    normalizeWarningMessage(source.defaultWarningMessage) ?? DEFAULT_WARNING;
  const rawRules = Array.isArray(source.rules) ? source.rules.slice(0, 200) : [];
  const ruleMap = new Map<string, ChannelPolicyRule>();

  for (const rawRule of rawRules) {
    const rule = normalizeChannelPolicyRule(rawRule);
    if (!rule) continue;
    ruleMap.delete(rule.channelId);
    ruleMap.set(rule.channelId, rule);
  }

  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    warningCooldownSeconds,
    defaultWarningMessage,
    rules: [...ruleMap.values()],
  };
}

function normalizeChannelPolicyRule(value: unknown): ChannelPolicyRule | null {
  if (!isRecord(value)) return null;
  const channelId = normalizeDiscordId(value.channelId);
  if (!channelId) return null;

  const mode =
    typeof value.mode === 'string' && MODES.has(value.mode as ChannelPolicyMode)
      ? (value.mode as ChannelPolicyMode)
      : 'commands_only';
  const action =
    typeof value.action === 'string' && ACTIONS.has(value.action as ChannelPolicyAction)
      ? (value.action as ChannelPolicyAction)
      : 'warn_delete';

  return {
    enabled: value.enabled === undefined ? true : value.enabled === true,
    channelId,
    mode,
    action,
    allowCaption: value.allowCaption === undefined ? true : value.allowCaption === true,
    allowStickers: value.allowStickers === true,
    includeThreads: value.includeThreads === undefined ? true : value.includeThreads === true,
    exemptRoleIds: normalizeDiscordIdArray(value.exemptRoleIds),
    exemptUserIds: normalizeDiscordIdArray(value.exemptUserIds),
    warningMessage: normalizeWarningMessage(value.warningMessage),
  };
}

export function findChannelPolicyRule(
  config: ChannelPolicyConfig,
  channelId: string,
  parentChannelId: string | null,
  isThread: boolean,
): ChannelPolicyRule | null {
  const direct = config.rules.find((rule) => rule.channelId === channelId);
  if (direct) return direct;
  if (!isThread || !parentChannelId) return null;
  return (
    config.rules.find((rule) => rule.channelId === parentChannelId && rule.includeThreads) ?? null
  );
}

export function evaluateChannelPolicyMessage(
  message: Pick<ChannelPolicyMessage, 'content' | 'attachments' | 'stickers'>,
  rule: ChannelPolicyRule,
): ChannelPolicyEvaluation {
  const content = message.content.trim();
  const attachments = [...message.attachments.values()];
  const attachmentKinds = attachments.map(classifyAttachment);
  const hasAttachments = attachments.length > 0;
  const hasImages = attachmentKinds.includes('image');
  const hasVideos = attachmentKinds.includes('video');
  const allMedia =
    hasAttachments && attachmentKinds.every((kind) => kind === 'image' || kind === 'video');
  const allImages = hasAttachments && attachmentKinds.every((kind) => kind === 'image');
  const allVideos = hasAttachments && attachmentKinds.every((kind) => kind === 'video');
  const hasStickers = message.stickers.size > 0;
  const hasUrls = containsHttpUrl(content);

  switch (rule.mode) {
    case 'commands_only':
      return deny('通常メッセージは許可されていません');
    case 'media_only': {
      const hasAllowedMedia = allMedia || (rule.allowStickers && hasStickers && !hasAttachments);
      if (!hasAllowedMedia) return deny('画像または動画が必要です');
      if (hasStickers && !rule.allowStickers) return deny('Stickerは許可されていません');
      if (!rule.allowCaption && content.length > 0)
        return deny('添付ファイル以外の本文は許可されていません');
      return allow();
    }
    case 'images_only':
      if (!allImages || hasVideos || hasStickers) return deny('画像ファイルだけ投稿できます');
      if (!rule.allowCaption && content.length > 0)
        return deny('画像以外の本文は許可されていません');
      return allow();
    case 'videos_only':
      if (!allVideos || hasImages || hasStickers) return deny('動画ファイルだけ投稿できます');
      if (!rule.allowCaption && content.length > 0)
        return deny('動画以外の本文は許可されていません');
      return allow();
    case 'attachments_only':
      if (!hasAttachments || hasStickers) return deny('添付ファイルが必要です');
      if (!rule.allowCaption && content.length > 0)
        return deny('添付ファイル以外の本文は許可されていません');
      return allow();
    case 'text_only':
      if (content.length === 0) return deny('テキスト本文が必要です');
      if (hasAttachments || hasStickers) return deny('添付ファイルやStickerは許可されていません');
      return allow();
    case 'links_only':
      if (!hasUrls) return deny('HTTP(S)リンクが必要です');
      if (hasAttachments || hasStickers) return deny('リンク以外の添付は許可されていません');
      if (removeHttpUrls(content).trim().length > 0)
        return deny('リンク以外の本文は許可されていません');
      return allow();
    case 'no_links':
      return hasUrls ? deny('HTTP(S)リンクは許可されていません') : allow();
  }
}

export function shouldSendChannelPolicyWarning(
  guildId: string,
  channelId: string,
  userId: string,
  cooldownSeconds: number,
  nowMs = Date.now(),
): boolean {
  if (cooldownSeconds <= 0) return true;
  const key = `${guildId}:${channelId}:${userId}`;
  const expiresAt = warningCooldowns.get(key) ?? 0;
  if (expiresAt > nowMs) return false;

  warningCooldowns.set(key, nowMs + cooldownSeconds * 1000);
  pruneWarningCooldowns(nowMs);
  return true;
}

export function resetChannelPolicyRuntime(guildId?: string): void {
  if (!guildId) {
    warningCooldowns.clear();
    return;
  }
  const prefix = `${guildId}:`;
  for (const key of warningCooldowns.keys()) {
    if (key.startsWith(prefix)) warningCooldowns.delete(key);
  }
}

function pruneWarningCooldowns(nowMs: number): void {
  if (warningCooldowns.size <= MAX_WARNING_COOLDOWNS) return;

  for (const [key, expiresAt] of warningCooldowns) {
    if (expiresAt <= nowMs) warningCooldowns.delete(key);
  }

  while (warningCooldowns.size > MAX_WARNING_COOLDOWNS) {
    const oldestKey = warningCooldowns.keys().next().value as string | undefined;
    if (!oldestKey) break;
    warningCooldowns.delete(oldestKey);
  }
}

function isExempt(message: ChannelPolicyMessage, rule: ChannelPolicyRule): boolean {
  if (rule.exemptUserIds.includes(message.author.id)) return true;
  return rule.exemptRoleIds.some((roleId) => message.member?.roles.cache.has(roleId) === true);
}

function classifyAttachment(attachment: ChannelPolicyAttachment): 'image' | 'video' | 'other' {
  const contentType = attachment.contentType?.toLowerCase() ?? '';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';

  const name = attachment.name?.toLowerCase() ?? '';
  const extension = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'other';
}

function containsHttpUrl(content: string): boolean {
  URL_PATTERN.lastIndex = 0;
  return URL_PATTERN.test(content);
}

function removeHttpUrls(content: string): string {
  DISCORD_WRAPPED_URL_PATTERN.lastIndex = 0;
  const withoutWrappedUrls = content.replace(DISCORD_WRAPPED_URL_PATTERN, '');
  URL_PATTERN.lastIndex = 0;
  return withoutWrappedUrls.replace(URL_PATTERN, '');
}

function formatChannelPolicyWarning(
  template: string,
  message: Pick<ChannelPolicyMessage, 'author' | 'channelId'>,
  rule: ChannelPolicyRule,
): string {
  return template
    .replaceAll('{user}', `<@${message.author.id}>`)
    .replaceAll('{channel}', `<#${message.channelId}>`)
    .replaceAll('{mode}', rule.mode)
    .slice(0, 1000);
}

function normalizeDiscordId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return DISCORD_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeDiscordIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map(normalizeDiscordId).filter((id): id is string => Boolean(id))),
  ].slice(0, 100);
}

function normalizeWarningMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.slice(0, 1000);
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function allow(): ChannelPolicyEvaluation {
  return { allowed: true, reason: null };
}

function deny(reason: string): ChannelPolicyEvaluation {
  return { allowed: false, reason };
}
