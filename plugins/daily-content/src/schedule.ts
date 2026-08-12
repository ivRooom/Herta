import {
  DailyContentValidationError,
  isValidIanaTimezone,
  normalizeScheduleTime,
  type MessageStudioRecurrence,
} from './config.js';

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const LOCAL_RESOLUTION_WINDOW_MS = 4 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const MAX_LOCAL_DAY_LOOKAHEAD = 15;

export interface NextDailyOccurrenceInput {
  scheduleTime: string;
  timezone: string;
  after: Date;
}

export interface NextContentOccurrenceInput extends NextDailyOccurrenceInput {
  recurrenceType: MessageStudioRecurrence;
  onceAt?: Date | null;
  weekdays?: readonly number[];
}

/**
 * 指定timezoneの壁時計時刻として、afterより後に到来する最初のUTC時刻を返す。
 * DSTで存在しない時刻は次の日へ送り、重複する時刻はafterより後の早い方を採用する。
 */
export function nextDailyOccurrence(input: NextDailyOccurrenceInput): Date {
  return nextRecurringOccurrence({ ...input, recurrenceType: 'daily' })!;
}

export function nextContentOccurrence(input: NextContentOccurrenceInput): Date | null {
  if (input.recurrenceType === 'once') {
    const onceAt = input.onceAt;
    if (!onceAt || Number.isNaN(onceAt.getTime())) {
      throw new DailyContentValidationError('1回予約の日時が不正です');
    }
    return onceAt.getTime() > input.after.getTime() ? onceAt : null;
  }
  return nextRecurringOccurrence(input);
}

export function nextWeeklyOccurrence(input: {
  scheduleTime: string;
  timezone: string;
  weekdays: readonly number[];
  after: Date;
}): Date {
  const next = nextRecurringOccurrence({ ...input, recurrenceType: 'weekly' });
  if (!next) throw new DailyContentValidationError('次回週次配信日時を計算できませんでした');
  return next;
}

function nextRecurringOccurrence(input: NextContentOccurrenceInput): Date | null {
  const scheduleTime = normalizeScheduleTime(input.scheduleTime);
  const timezone = input.timezone.trim();
  if (!isValidIanaTimezone(timezone)) {
    throw new DailyContentValidationError('timezoneに有効なIANA timezoneを指定してください');
  }
  if (Number.isNaN(input.after.getTime())) {
    throw new DailyContentValidationError('afterに有効な日時を指定してください');
  }

  const weekdays = normalizeWeekdays(input.weekdays ?? [], input.recurrenceType);
  const [hourText, minuteText] = scheduleTime.split(':');
  const hour = Number.parseInt(hourText!, 10);
  const minute = Number.parseInt(minuteText!, 10);
  const localAfter = getZonedDateParts(input.after, timezone);

  for (let offsetDays = 0; offsetDays <= MAX_LOCAL_DAY_LOOKAHEAD; offsetDays += 1) {
    const localDate = addLocalDays(localAfter, offsetDays);
    if (input.recurrenceType === 'weekly') {
      const weekday = isoWeekday(localDate.year, localDate.month, localDate.day);
      if (!weekdays.includes(weekday)) continue;
    }
    const candidates = resolveLocalDateTimeCandidates(
      {
        year: localDate.year,
        month: localDate.month,
        day: localDate.day,
        hour,
        minute,
      },
      timezone,
    );
    const next = candidates.find((candidate) => candidate.getTime() > input.after.getTime());
    if (next) return next;
  }

  throw new DailyContentValidationError('次回配信日時を計算できませんでした');
}

export function dailyContentIdempotencyKey(scheduleId: string, scheduledFor: Date): string {
  const normalizedId = scheduleId.trim();
  if (!normalizedId) {
    throw new DailyContentValidationError('scheduleIdは必須です');
  }
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new DailyContentValidationError('scheduledForに有効な日時を指定してください');
  }
  return `${normalizedId}:${scheduledFor.toISOString()}`;
}

export function formatDailyOccurrence(date: Date, timezone: string): string {
  const parts = getZonedDateParts(date, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

function normalizeWeekdays(value: readonly number[], recurrence: MessageStudioRecurrence): number[] {
  if (recurrence !== 'weekly') return [];
  const normalized = [...new Set(value.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))];
  if (normalized.length === 0) {
    throw new DailyContentValidationError('週次配信では曜日を1つ以上指定してください');
  }
  return normalized;
}

function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function resolveLocalDateTimeCandidates(target: ZonedDateParts, timezone: string): Date[] {
  const targetEpoch = partsAsUtcEpoch(target);
  let candidateEpoch = targetEpoch;

  for (let index = 0; index < 4; index += 1) {
    const observed = getZonedDateParts(new Date(candidateEpoch), timezone);
    const difference = targetEpoch - partsAsUtcEpoch(observed);
    candidateEpoch += difference;
    if (difference === 0) break;
  }

  const matches = new Map<number, Date>();
  const start = candidateEpoch - LOCAL_RESOLUTION_WINDOW_MS;
  const end = candidateEpoch + LOCAL_RESOLUTION_WINDOW_MS;
  for (let instant = start; instant <= end; instant += ONE_MINUTE_MS) {
    const rounded = Math.floor(instant / ONE_MINUTE_MS) * ONE_MINUTE_MS;
    const parts = getZonedDateParts(new Date(rounded), timezone);
    if (sameLocalDateTime(parts, target)) {
      matches.set(rounded, new Date(rounded));
    }
  }

  return [...matches.values()].sort((left, right) => left.getTime() - right.getTime());
}

function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const formatter = getFormatter(timezone);
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: readPart(values, 'year'),
    month: readPart(values, 'month'),
    day: readPart(values, 'day'),
    hour: readPart(values, 'hour'),
    minute: readPart(values, 'minute'),
  };
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

function addLocalDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
  };
}

function partsAsUtcEpoch(parts: ZonedDateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function sameLocalDateTime(left: ZonedDateParts, right: ZonedDateParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function readPart(values: Map<string, string>, key: string): number {
  const value = Number.parseInt(values.get(key) ?? '', 10);
  if (!Number.isFinite(value)) {
    throw new DailyContentValidationError(`timezone日時の${key}を取得できませんでした`);
  }
  return value;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
