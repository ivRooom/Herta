export interface QuoteConfig {
  allowMemberRegistration: boolean;
  allowMemberDeletion: boolean;
  maxQuoteLength: number;
  randomResponseEphemeral: boolean;
  allowedChannelIds: string[];
}

export const DEFAULT_QUOTE_CONFIG: QuoteConfig = {
  allowMemberRegistration: true,
  allowMemberDeletion: false,
  maxQuoteLength: 1000,
  randomResponseEphemeral: false,
  allowedChannelIds: [],
};

export const MAX_QUOTE_TAGS = 5;
export const MAX_QUOTE_TAG_LENGTH = 32;
export const MAX_QUOTE_LENGTH = 1800;

export class QuoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteValidationError';
  }
}

export function normalizeQuoteConfig(value: unknown): QuoteConfig {
  const config = isRecord(value) ? value : {};
  const maxQuoteLength = toSafeInteger(config.maxQuoteLength, DEFAULT_QUOTE_CONFIG.maxQuoteLength);

  return {
    allowMemberRegistration: toBoolean(
      config.allowMemberRegistration,
      DEFAULT_QUOTE_CONFIG.allowMemberRegistration,
    ),
    allowMemberDeletion: toBoolean(config.allowMemberDeletion, DEFAULT_QUOTE_CONFIG.allowMemberDeletion),
    maxQuoteLength: Math.min(Math.max(maxQuoteLength, 1), MAX_QUOTE_LENGTH),
    randomResponseEphemeral: toBoolean(
      config.randomResponseEphemeral,
      DEFAULT_QUOTE_CONFIG.randomResponseEphemeral,
    ),
    allowedChannelIds: normalizeChannelIds(config.allowedChannelIds),
  };
}

export function validateQuoteText(value: unknown, maxLength = MAX_QUOTE_LENGTH): string {
  if (typeof value !== 'string') throw new QuoteValidationError('名言本文を入力してください');
  const text = value.trim();
  if (!text) throw new QuoteValidationError('名言本文を入力してください');
  if (text.length > maxLength) {
    throw new QuoteValidationError(`名言本文は${maxLength}文字以内で入力してください`);
  }
  return text;
}

export function normalizeOptionalText(value: unknown, maxLength: number, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new QuoteValidationError(`${label}が不正です`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new QuoteValidationError(`${label}は${maxLength}文字以内で入力してください`);
  }
  return normalized;
}

export function parseQuoteTags(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;

  if (!rawTags || rawTags.some((tag) => typeof tag !== 'string')) {
    throw new QuoteValidationError('タグは文字列または文字列配列で指定してください');
  }

  const normalized = [...new Set(rawTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (normalized.length > MAX_QUOTE_TAGS) {
    throw new QuoteValidationError(`タグは最大${MAX_QUOTE_TAGS}件まで指定できます`);
  }
  const tooLong = normalized.find((tag) => tag.length > MAX_QUOTE_TAG_LENGTH);
  if (tooLong) {
    throw new QuoteValidationError(`タグは1件${MAX_QUOTE_TAG_LENGTH}文字以内で指定してください`);
  }
  return normalized;
}

function normalizeChannelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item));
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toSafeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
