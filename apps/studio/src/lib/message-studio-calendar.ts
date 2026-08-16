export interface MessageStudioCalendarMonth {
  year: number;
  month: number;
  key: string;
}

export interface MessageStudioCalendarOccurrence {
  scheduleId: string;
  channelId: string;
  title: string;
  scheduledAt: Date;
  scheduleTimezone: string;
  recurrenceType: 'once' | 'daily' | 'weekly';
  messageFormat: 'text' | 'embed';
  publishAnnouncement: boolean;
}

export interface MessageStudioCalendarEntry extends MessageStudioCalendarOccurrence {
  dateKey: string;
  timeLabel: string;
  conflictCount: number;
}

const CALENDAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export function parseMessageStudioCalendarMonth(
  value: string | null | undefined,
  now = new Date(),
  timezone = 'Asia/Tokyo',
): MessageStudioCalendarMonth {
  const match = value?.match(CALENDAR_MONTH_PATTERN);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12) {
      return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
    }
  }

  const parts = zonedDateParts(now, timezone);
  return {
    year: parts.year,
    month: parts.month,
    key: `${parts.year}-${String(parts.month).padStart(2, '0')}`,
  };
}

export function shiftMessageStudioCalendarMonth(
  month: MessageStudioCalendarMonth,
  offset: number,
): MessageStudioCalendarMonth {
  const shifted = new Date(Date.UTC(month.year, month.month - 1 + offset, 1));
  const year = shifted.getUTCFullYear();
  const monthNumber = shifted.getUTCMonth() + 1;
  return {
    year,
    month: monthNumber,
    key: `${year}-${String(monthNumber).padStart(2, '0')}`,
  };
}

export function messageStudioCalendarScanRange(month: MessageStudioCalendarMonth): {
  start: Date;
  end: Date;
} {
  // Timezone offsetの最大幅を吸収するため前後48時間をscanし、表示時にmonthへ絞り込む。
  return {
    start: new Date(Date.UTC(month.year, month.month - 1, 1) - 48 * 60 * 60 * 1000),
    end: new Date(Date.UTC(month.year, month.month, 1) + 48 * 60 * 60 * 1000),
  };
}

export function buildMessageStudioCalendarEntries(
  occurrences: MessageStudioCalendarOccurrence[],
  month: MessageStudioCalendarMonth,
  displayTimezone: string,
): MessageStudioCalendarEntry[] {
  const monthPrefix = `${month.key}-`;
  const base = occurrences
    .map((occurrence) => ({
      ...occurrence,
      dateKey: zonedDateKey(occurrence.scheduledAt, displayTimezone),
      timeLabel: zonedTimeLabel(occurrence.scheduledAt, displayTimezone),
      conflictCount: 1,
    }))
    .filter((entry) => entry.dateKey.startsWith(monthPrefix))
    .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());

  const conflictCounts = new Map<string, number>();
  for (const entry of base) {
    const key = `${entry.dateKey}:${entry.timeLabel}:${entry.channelId}`;
    conflictCounts.set(key, (conflictCounts.get(key) ?? 0) + 1);
  }

  return base.map((entry) => ({
    ...entry,
    conflictCount:
      conflictCounts.get(`${entry.dateKey}:${entry.timeLabel}:${entry.channelId}`) ?? 1,
  }));
}

export function buildMessageStudioCalendarDays(month: MessageStudioCalendarMonth): Array<{
  day: number;
  dateKey: string;
}> {
  const lastDay = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => {
    const day = index + 1;
    return {
      day,
      dateKey: `${month.key}-${String(day).padStart(2, '0')}`,
    };
  });
}

export function firstWeekdayOfMessageStudioCalendarMonth(
  month: MessageStudioCalendarMonth,
): number {
  return new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay();
}

export function zonedDateKey(date: Date, timezone: string): string {
  const parts = zonedDateParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function zonedTimeLabel(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.format(date);
}

function zonedDateParts(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const read = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = read('year');
  const month = read('month');
  const day = read('day');
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError(`Timezone date formatting failed: ${timezone}`);
  }
  return { year, month, day };
}
