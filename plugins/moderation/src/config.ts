export interface ModerationConfig {
  requireReason: boolean;
  dmTarget: boolean;
  logChannelId: string | null;
  defaultResponseEphemeral: boolean;
  maxReasonLength: number;
  caseRetentionDays: number;
  allowedModeratorRoleIds: string[];
}

export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
  requireReason: true,
  dmTarget: true,
  logChannelId: null,
  defaultResponseEphemeral: true,
  maxReasonLength: 500,
  caseRetentionDays: 365,
  allowedModeratorRoleIds: [],
};

export const MAX_MODERATION_REASON_LENGTH = 1000;
export const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;
export const MAX_BAN_DELETE_MESSAGE_SECONDS = 7 * 24 * 60 * 60;

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
  };
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
