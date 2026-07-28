export interface DailyContentConfig {
  defaultTimezone: string;
  maxSchedules: number;
  maxContentLength: number;
  allowUserMentions: boolean;
  staleAfterMinutes: number;
  maxAttempts: number;
}

export interface DailyContentInput {
  channelId: string;
  title?: string | null;
  content: string;
  scheduleTime: string;
  timezone?: string | null;
  enabled?: boolean;
}

export interface NormalizedDailyContentInput {
  channelId: string;
  title: string;
  content: string;
  scheduleTime: string;
  timezone: string;
  enabled: boolean;
}

export const DAILY_CONTENT_DEFAULTS: DailyContentConfig = {
  defaultTimezone: 'Asia/Tokyo',
  maxSchedules: 100,
  maxContentLength: 2000,
  allowUserMentions: false,
  staleAfterMinutes: 10,
  maxAttempts: 5,
};

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const SCHEDULE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const USER_MENTION_PATTERN = /<@!?\d{17,20}>/;
const ROLE_MENTION_PATTERN = /<@&\d{17,20}>/;

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

  const content = input.content.trim();
  if (!content) {
    throw new DailyContentValidationError('contentは必須です');
  }
  if (content.length > config.maxContentLength) {
    throw new DailyContentValidationError(
      `contentは${config.maxContentLength}文字以内で指定してください`,
    );
  }
  assertSafeMentions(content, config.allowUserMentions);

  const scheduleTime = normalizeScheduleTime(input.scheduleTime);
  const timezone = (input.timezone ?? config.defaultTimezone).trim();
  if (!isValidIanaTimezone(timezone)) {
    throw new DailyContentValidationError('timezoneに有効なIANA timezoneを指定してください');
  }

  return {
    channelId,
    title,
    content,
    scheduleTime,
    timezone,
    enabled: input.enabled ?? true,
  };
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
