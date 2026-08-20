import { AUTOMATIC_CASE_RULE_SELECTOR_PATTERN } from './auto-case.js';

export { shouldAutoCreateCaseOnConfirmed } from './auto-case.js';

export type AutomaticModerationMode = 'disabled' | 'observe';
export type AutomaticModerationScope = 'guild' | 'channel';

export interface ModerationConfig {
  requireReason: boolean;
  dmTarget: boolean;
  logChannelId: string | null;
  defaultResponseEphemeral: boolean;
  maxReasonLength: number;
  caseRetentionDays: number;
  allowedModeratorRoleIds: string[];
  automaticMode: AutomaticModerationMode;
  autoExactWords: string[];
  autoContainsWords: string[];
  autoRegexPatterns: string[];
  autoInviteFilterEnabled: boolean;
  autoInviteAllowlist: string[];
  autoMentionLimit: number;
  autoBurstMessageLimit: number;
  autoBurstWindowSeconds: number;
  autoBurstScope: AutomaticModerationScope;
  autoDuplicateMessageLimit: number;
  autoDuplicateWindowSeconds: number;
  autoDuplicateScope: AutomaticModerationScope;
  autoDuplicateMinimumLength: number;
  autoCaseOnConfirmedEnabled: boolean;
  autoCaseOnConfirmedRules: string[];
  autoMaxMessageLength: number;
  autoExemptChannelIds: string[];
  autoExemptRoleIds: string[];
  autoExemptUserIds: string[];
}

export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
  requireReason: true,
  dmTarget: true,
  logChannelId: null,
  defaultResponseEphemeral: true,
  maxReasonLength: 500,
  caseRetentionDays: 365,
  allowedModeratorRoleIds: [],
  automaticMode: 'disabled',
  autoExactWords: [],
  autoContainsWords: [],
  autoRegexPatterns: [],
  autoInviteFilterEnabled: false,
  autoInviteAllowlist: [],
  autoMentionLimit: 0,
  autoBurstMessageLimit: 0,
  autoBurstWindowSeconds: 10,
  autoBurstScope: 'guild',
  autoDuplicateMessageLimit: 0,
  autoDuplicateWindowSeconds: 30,
  autoDuplicateScope: 'guild',
  autoDuplicateMinimumLength: 1,
  autoCaseOnConfirmedEnabled: false,
  autoCaseOnConfirmedRules: [],
  autoMaxMessageLength: 2000,
  autoExemptChannelIds: [],
  autoExemptRoleIds: [],
  autoExemptUserIds: [],
};

export const MAX_MODERATION_REASON_LENGTH = 1000;
export const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;
export const MAX_BAN_DELETE_MESSAGE_SECONDS = 7 * 24 * 60 * 60;
export const MAX_AUTOMATIC_WORD_PATTERNS = 100;
export const MAX_AUTOMATIC_REGEX_PATTERNS = 20;
export const MAX_AUTOMATIC_PATTERN_LENGTH = 120;
export const MAX_AUTOMATIC_MESSAGE_LENGTH = 4000;
export const MAX_AUTOMATIC_DUPLICATE_MINIMUM_LENGTH = 200;

export class ModerationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModerationValidationError';
  }
}

export function normalizeModerationConfig(value: unknown): ModerationConfig {
  const config = isRecord(value) ? value : {};
  const maxReasonLength = clampInteger(
    config.maxReasonLength,
    DEFAULT_MODERATION_CONFIG.maxReasonLength,
    1,
    MAX_MODERATION_REASON_LENGTH,
  );
  const caseRetentionDays = clampInteger(
    config.caseRetentionDays,
    DEFAULT_MODERATION_CONFIG.caseRetentionDays,
    30,
    3650,
  );

  return {
    requireReason: booleanValue(config.requireReason, DEFAULT_MODERATION_CONFIG.requireReason),
    dmTarget: booleanValue(config.dmTarget, DEFAULT_MODERATION_CONFIG.dmTarget),
    logChannelId: normalizeDiscordId(config.logChannelId),
    defaultResponseEphemeral: booleanValue(
      config.defaultResponseEphemeral,
      DEFAULT_MODERATION_CONFIG.defaultResponseEphemeral,
    ),
    maxReasonLength,
    caseRetentionDays,
    allowedModeratorRoleIds: normalizeDiscordIds(config.allowedModeratorRoleIds),
    automaticMode: normalizeAutomaticModerationMode(config.automaticMode),
    autoExactWords: normalizeAutomaticWordPatterns(config.autoExactWords),
    autoContainsWords: normalizeAutomaticWordPatterns(config.autoContainsWords),
    autoRegexPatterns: normalizeAutomaticRegexPatterns(config.autoRegexPatterns),
    autoInviteFilterEnabled: booleanValue(
      config.autoInviteFilterEnabled,
      DEFAULT_MODERATION_CONFIG.autoInviteFilterEnabled,
    ),
    autoInviteAllowlist: normalizeInviteCodes(config.autoInviteAllowlist),
    autoMentionLimit: clampInteger(
      config.autoMentionLimit,
      DEFAULT_MODERATION_CONFIG.autoMentionLimit,
      0,
      100,
    ),
    autoBurstMessageLimit: clampInteger(
      config.autoBurstMessageLimit,
      DEFAULT_MODERATION_CONFIG.autoBurstMessageLimit,
      0,
      50,
    ),
    autoBurstWindowSeconds: clampInteger(
      config.autoBurstWindowSeconds,
      DEFAULT_MODERATION_CONFIG.autoBurstWindowSeconds,
      1,
      300,
    ),
    autoBurstScope: normalizeAutomaticModerationScope(config.autoBurstScope),
    autoDuplicateMessageLimit: clampInteger(
      config.autoDuplicateMessageLimit,
      DEFAULT_MODERATION_CONFIG.autoDuplicateMessageLimit,
      0,
      20,
    ),
    autoDuplicateWindowSeconds: clampInteger(
      config.autoDuplicateWindowSeconds,
      DEFAULT_MODERATION_CONFIG.autoDuplicateWindowSeconds,
      1,
      600,
    ),
    autoDuplicateScope: normalizeAutomaticModerationScope(config.autoDuplicateScope),
    autoDuplicateMinimumLength: clampInteger(
      config.autoDuplicateMinimumLength,
      DEFAULT_MODERATION_CONFIG.autoDuplicateMinimumLength,
      1,
      MAX_AUTOMATIC_DUPLICATE_MINIMUM_LENGTH,
    ),
    autoCaseOnConfirmedEnabled: booleanValue(
      config.autoCaseOnConfirmedEnabled,
      DEFAULT_MODERATION_CONFIG.autoCaseOnConfirmedEnabled,
    ),
    autoCaseOnConfirmedRules: normalizeAutomaticCaseRules(config.autoCaseOnConfirmedRules),
    autoMaxMessageLength: clampInteger(
      config.autoMaxMessageLength,
      DEFAULT_MODERATION_CONFIG.autoMaxMessageLength,
      100,
      MAX_AUTOMATIC_MESSAGE_LENGTH,
    ),
    autoExemptChannelIds: normalizeDiscordIds(config.autoExemptChannelIds),
    autoExemptRoleIds: normalizeDiscordIds(config.autoExemptRoleIds),
    autoExemptUserIds: normalizeDiscordIds(config.autoExemptUserIds),
  };
}

export function normalizeAutomaticText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ja-JP');
}

export function isSafeAutomaticRegexPattern(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_AUTOMATIC_PATTERN_LENGTH) return false;
  if (/\\[1-9]/u.test(pattern)) return false;
  if (/\(\?[=!<]/u.test(pattern)) return false;
  if (/\([^)]*(?:\+|\*|\{\d+,?\d*\})[^)]*\)(?:\+|\*|\{\d+,?\d*\})/u.test(pattern)) {
    return false;
  }

  try {
    new RegExp(pattern, 'iu');
    return true;
  } catch {
    return false;
  }
}

export function normalizeModerationReason(
  value: unknown,
  config: Pick<ModerationConfig, 'requireReason' | 'maxReasonLength'>,
): string | null {
  if (value === undefined || value === null || value === '') {
    if (config.requireReason) throw new ModerationValidationError('理由を入力してください');
    return null;
  }
  if (typeof value !== 'string') throw new ModerationValidationError('理由が不正です');
  const reason = value.trim();
  if (!reason) {
    if (config.requireReason) throw new ModerationValidationError('理由を入力してください');
    return null;
  }
  if (reason.length > config.maxReasonLength) {
    throw new ModerationValidationError(
      `理由は${config.maxReasonLength}文字以内で入力してください`,
    );
  }
  return reason;
}

export function normalizeTimeoutMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ModerationValidationError('タイムアウト時間は整数で指定してください');
  }
  if (value < 1 || value > MAX_TIMEOUT_MINUTES) {
    throw new ModerationValidationError(
      `タイムアウト時間は1〜${MAX_TIMEOUT_MINUTES}分で指定してください`,
    );
  }
  return value;
}

export function normalizeDeleteMessageSeconds(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ModerationValidationError('メッセージ削除秒数は整数で指定してください');
  }
  if (value < 0 || value > MAX_BAN_DELETE_MESSAGE_SECONDS) {
    throw new ModerationValidationError(
      `メッセージ削除秒数は0〜${MAX_BAN_DELETE_MESSAGE_SECONDS}秒で指定してください`,
    );
  }
  return value;
}

function normalizeAutomaticModerationMode(value: unknown): AutomaticModerationMode {
  return value === 'observe' ? 'observe' : 'disabled';
}

function normalizeAutomaticModerationScope(value: unknown): AutomaticModerationScope {
  return value === 'channel' ? 'channel' : 'guild';
}

function normalizeAutomaticWordPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map(normalizeAutomaticText)
    .filter((item) => item.length > 0 && item.length <= MAX_AUTOMATIC_PATTERN_LENGTH);
  return [...new Set(normalized)].slice(0, MAX_AUTOMATIC_WORD_PATTERNS);
}

function normalizeAutomaticRegexPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(isSafeAutomaticRegexPattern);
  return [...new Set(normalized)].slice(0, MAX_AUTOMATIC_REGEX_PATTERNS);
}

function normalizeAutomaticCaseRules(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const selectorPattern = new RegExp(AUTOMATIC_CASE_RULE_SELECTOR_PATTERN, 'u');
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => selectorPattern.test(item));
  return [...new Set(normalized)].slice(0, MAX_AUTOMATIC_WORD_PATTERNS);
}

function normalizeInviteCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLocaleLowerCase('en-US'))
    .filter((item) => /^[a-z0-9-]{2,64}$/u.test(item));
  return [...new Set(normalized)].slice(0, MAX_AUTOMATIC_WORD_PATTERNS);
}

function normalizeDiscordId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && /^\d+$/.test(value.trim()) ? value.trim() : null;
}

function normalizeDiscordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => /^\d+$/.test(item)),
    ),
  ];
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
  return Math.min(Math.max(normalized, minimum), maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
