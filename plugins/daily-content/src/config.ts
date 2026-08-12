export type MessageStudioRecurrence = 'once' | 'daily' | 'weekly';
export type MessageStudioFormat = 'text' | 'embed';

export interface MessageStudioEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface MessageStudioEmbed {
  title?: string;
  description?: string;
  color?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  footerText?: string;
  fields?: MessageStudioEmbedField[];
}

export interface DailyContentConfig {
  defaultTimezone: string;
  defaultAnnouncementChannelId: string | null;
  maxSchedules: number;
  maxContentLength: number;
  allowUserMentions: boolean;
  allowAnnouncementCrosspost: boolean;
  defaultMentionRepliedUser: boolean;
  staleAfterMinutes: number;
  maxAttempts: number;
}

export interface DailyContentInput {
  channelId: string;
  title?: string | null;
  content?: string | null;
  scheduleTime: string;
  timezone?: string | null;
  enabled?: boolean;
  recurrenceType?: MessageStudioRecurrence;
  onceAt?: Date | string | null;
  weekdays?: number[] | null;
  messageFormat?: MessageStudioFormat;
  embed?: MessageStudioEmbed | null;
  publishAnnouncement?: boolean;
}

export interface NormalizedDailyContentInput {
  channelId: string;
  title: string;
  content: string;
  scheduleTime: string;
  timezone: string;
  enabled: boolean;
  recurrenceType: MessageStudioRecurrence;
  onceAt: Date | null;
  weekdays: number[];
  messageFormat: MessageStudioFormat;
  embed: MessageStudioEmbed | null;
  publishAnnouncement: boolean;
}

export const DAILY_CONTENT_DEFAULTS: DailyContentConfig = {
  defaultTimezone: 'Asia/Tokyo',
  defaultAnnouncementChannelId: null,
  maxSchedules: 100,
  maxContentLength: 2000,
  allowUserMentions: false,
  allowAnnouncementCrosspost: false,
  defaultMentionRepliedUser: true,
  staleAfterMinutes: 10,
  maxAttempts: 5,
};

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const SCHEDULE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const USER_MENTION_PATTERN = /<@!?\d{17,20}>/;
const ROLE_MENTION_PATTERN = /<@&\d{17,20}>/;
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const MAX_EMBED_TOTAL_LENGTH = 6000;

export class DailyContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyContentValidationError';
  }
}

export function normalizeDailyContentConfig(input: unknown): DailyContentConfig {
  const source = isRecord(input) ? input : {};
  const defaultTimezone = readString(
    source['defaultTimezone'],
    DAILY_CONTENT_DEFAULTS.defaultTimezone,
  );
  if (!isValidIanaTimezone(defaultTimezone)) {
    throw new DailyContentValidationError('defaultTimezoneに有効なIANA timezoneを指定してください');
  }

  return {
    defaultTimezone,
    defaultAnnouncementChannelId: readDiscordIdOrNull(source['defaultAnnouncementChannelId']),
    maxSchedules: readInteger(source['maxSchedules'], DAILY_CONTENT_DEFAULTS.maxSchedules, 1, 500),
    maxContentLength: readInteger(
      source['maxContentLength'],
      DAILY_CONTENT_DEFAULTS.maxContentLength,
      1,
      2000,
    ),
    allowUserMentions: readBoolean(
      source['allowUserMentions'],
      DAILY_CONTENT_DEFAULTS.allowUserMentions,
    ),
    allowAnnouncementCrosspost: readBoolean(
      source['allowAnnouncementCrosspost'],
      DAILY_CONTENT_DEFAULTS.allowAnnouncementCrosspost,
    ),
    defaultMentionRepliedUser: readBoolean(
      source['defaultMentionRepliedUser'],
      DAILY_CONTENT_DEFAULTS.defaultMentionRepliedUser,
    ),
    staleAfterMinutes: readInteger(
      source['staleAfterMinutes'],
      DAILY_CONTENT_DEFAULTS.staleAfterMinutes,
      2,
      1440,
    ),
    maxAttempts: readInteger(source['maxAttempts'], DAILY_CONTENT_DEFAULTS.maxAttempts, 1, 10),
  };
}

export function normalizeDailyContentInput(
  input: DailyContentInput,
  config: DailyContentConfig,
): NormalizedDailyContentInput {
  const channelId = input.channelId.trim();
  if (!DISCORD_SNOWFLAKE_PATTERN.test(channelId)) {
    throw new DailyContentValidationError('channelIdに有効なDiscordチャンネルIDを指定してください');
  }

  const title = (input.title ?? '').trim();
  if (title.length > 100) {
    throw new DailyContentValidationError('titleは100文字以内で指定してください');
  }

  const content = (input.content ?? '').trim();
  if (content.length > config.maxContentLength) {
    throw new DailyContentValidationError(
      `contentは${config.maxContentLength}文字以内で指定してください`,
    );
  }
  assertSafeMentions(content, config.allowUserMentions);

  const messageFormat = normalizeMessageFormat(input.messageFormat);
  const embed = normalizeMessageStudioEmbed(input.embed, config.allowUserMentions);
  if (!content && !embedHasVisibleContent(embed)) {
    throw new DailyContentValidationError('本文またはEmbedの内容を入力してください');
  }

  const recurrenceType = normalizeRecurrenceType(input.recurrenceType);
  const scheduleTime = normalizeScheduleTime(input.scheduleTime);
  const timezone = (input.timezone ?? config.defaultTimezone).trim();
  if (!isValidIanaTimezone(timezone)) {
    throw new DailyContentValidationError('timezoneに有効なIANA timezoneを指定してください');
  }
  const onceAt = normalizeOnceAt(input.onceAt, recurrenceType);
  const weekdays = normalizeWeekdays(input.weekdays, recurrenceType);

  return {
    channelId,
    title,
    content,
    scheduleTime,
    timezone,
    enabled: input.enabled ?? true,
    recurrenceType,
    onceAt,
    weekdays,
    messageFormat,
    embed,
    publishAnnouncement: input.publishAnnouncement === true,
  };
}

export function normalizeMessageStudioEmbed(
  input: unknown,
  allowUserMentions = false,
): MessageStudioEmbed | null {
  if (input === null || input === undefined) return null;
  if (!isRecord(input)) throw new DailyContentValidationError('embedの形式が不正です');
  const title = optionalString(input['title'], 256, 'Embed title');
  const description = optionalString(input['description'], 4096, 'Embed description');
  const footerText = optionalString(input['footerText'], 2048, 'Embed footer');
  const color = optionalColor(input['color']);
  const imageUrl = optionalHttpsUrl(input['imageUrl'], 'Embed image URL');
  const thumbnailUrl = optionalHttpsUrl(input['thumbnailUrl'], 'Embed thumbnail URL');
  if (description) assertSafeMentions(description, allowUserMentions);

  const rawFields = input['fields'];
  const fields: MessageStudioEmbedField[] = [];
  if (rawFields !== undefined && rawFields !== null) {
    if (!Array.isArray(rawFields) || rawFields.length > 25) {
      throw new DailyContentValidationError('Embed fieldsは最大25件です');
    }
    for (const field of rawFields) {
      if (!isRecord(field)) throw new DailyContentValidationError('Embed fieldの形式が不正です');
      const name = requiredString(field['name'], 256, 'Embed field name');
      const value = requiredString(field['value'], 1024, 'Embed field value');
      assertSafeMentions(value, allowUserMentions);
      fields.push({ name, value, inline: field['inline'] === true });
    }
  }

  const total =
    (title?.length ?? 0) +
    (description?.length ?? 0) +
    (footerText?.length ?? 0) +
    fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  if (total > MAX_EMBED_TOTAL_LENGTH) {
    throw new DailyContentValidationError('Embed全体は6000文字以内で指定してください');
  }
  if (!title && !description && !footerText && !imageUrl && !thumbnailUrl && fields.length === 0) {
    return null;
  }
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(color ? { color } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(footerText ? { footerText } : {}),
    ...(fields.length ? { fields } : {}),
  };
}

export function embedHasVisibleContent(embed: MessageStudioEmbed | null): boolean {
  return Boolean(
    embed &&
      (embed.title ||
        embed.description ||
        embed.imageUrl ||
        embed.thumbnailUrl ||
        embed.footerText ||
        embed.fields?.length),
  );
}

export function normalizeScheduleTime(value: string): string {
  const normalized = value.trim();
  if (!SCHEDULE_TIME_PATTERN.test(normalized)) {
    throw new DailyContentValidationError('scheduleTimeはHH:mm形式で指定してください');
  }
  return normalized;
}

export function isValidIanaTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function assertSafeMentions(content: string, allowUserMentions: boolean): void {
  if (content.includes('@everyone') || content.includes('@here')) {
    throw new DailyContentValidationError('@everyoneと@hereは使用できません');
  }
  if (ROLE_MENTION_PATTERN.test(content)) {
    throw new DailyContentValidationError('ロールメンションは使用できません');
  }
  if (!allowUserMentions && USER_MENTION_PATTERN.test(content)) {
    throw new DailyContentValidationError('ユーザーメンションはPlugin設定で許可されていません');
  }
}

function normalizeRecurrenceType(value: unknown): MessageStudioRecurrence {
  return value === 'once' || value === 'weekly' || value === 'daily' ? value : 'daily';
}

function normalizeMessageFormat(value: unknown): MessageStudioFormat {
  return value === 'embed' ? 'embed' : 'text';
}

function normalizeOnceAt(value: Date | string | null | undefined, recurrence: MessageStudioRecurrence) {
  if (recurrence !== 'once') return null;
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new DailyContentValidationError('1回予約ではonceAtに有効な日時を指定してください');
  }
  return date;
}

function normalizeWeekdays(value: number[] | null | undefined, recurrence: MessageStudioRecurrence) {
  if (recurrence !== 'weekly') return [];
  const normalized = [...new Set((value ?? []).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort(
    (a, b) => a - b,
  );
  if (normalized.length === 0) {
    throw new DailyContentValidationError('週次配信では曜日を1つ以上指定してください');
  }
  return normalized;
}

function optionalString(value: unknown, max: number, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new DailyContentValidationError(`${label}は文字列で指定してください`);
  const normalized = value.trim();
  if (normalized.length > max) throw new DailyContentValidationError(`${label}は${max}文字以内です`);
  return normalized || undefined;
}

function requiredString(value: unknown, max: number, label: string): string {
  const normalized = optionalString(value, max, label);
  if (!normalized) throw new DailyContentValidationError(`${label}は必須です`);
  return normalized;
}

function optionalColor(value: unknown): string | undefined {
  const normalized = optionalString(value, 7, 'Embed color');
  if (!normalized) return undefined;
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new DailyContentValidationError('Embed colorは#5865F2のような6桁HEXで指定してください');
  }
  return normalized.startsWith('#') ? normalized.toUpperCase() : `#${normalized.toUpperCase()}`;
}

function optionalHttpsUrl(value: unknown, label: string): string | undefined {
  const normalized = optionalString(value, 2048, label);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:') throw new Error('https only');
  } catch {
    throw new DailyContentValidationError(`${label}はhttps://で始まるURLを指定してください`);
  }
  return normalized;
}

function readDiscordIdOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DISCORD_SNOWFLAKE_PATTERN.test(value.trim())) return null;
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
