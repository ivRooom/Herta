import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMessageStudioCalendarEntries,
  buildMessageStudioCalendarDays,
  firstWeekdayOfMessageStudioCalendarMonth,
  messageStudioCalendarScanRange,
  parseMessageStudioCalendarMonth,
  shiftMessageStudioCalendarMonth,
} from './message-studio-calendar.ts';

test('month queryを検証し不正値は指定Timezoneの現在月へ戻す', () => {
  assert.deepEqual(parseMessageStudioCalendarMonth('2026-08'), {
    year: 2026,
    month: 8,
    key: '2026-08',
  });
  assert.deepEqual(
    parseMessageStudioCalendarMonth('2026-13', new Date('2026-08-16T15:30:00.000Z'), 'Asia/Tokyo'),
    { year: 2026, month: 8, key: '2026-08' },
  );
});

test('月移動は年境界をまたいで正規化する', () => {
  assert.deepEqual(shiftMessageStudioCalendarMonth({ year: 2026, month: 1, key: '2026-01' }, -1), {
    year: 2025,
    month: 12,
    key: '2025-12',
  });
  assert.deepEqual(shiftMessageStudioCalendarMonth({ year: 2026, month: 12, key: '2026-12' }, 1), {
    year: 2027,
    month: 1,
    key: '2027-01',
  });
});

test('scan rangeはTimezone境界を吸収するため月前後48時間を含める', () => {
  const range = messageStudioCalendarScanRange({ year: 2026, month: 8, key: '2026-08' });
  assert.equal(range.start.toISOString(), '2026-07-30T00:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-09-03T00:00:00.000Z');
});

test('同一チャンネル・同一分の投稿を重複として可視化する', () => {
  const entries = buildMessageStudioCalendarEntries(
    [
      {
        scheduleId: 'a',
        channelId: '123',
        title: 'A',
        scheduledAt: new Date('2026-08-20T09:00:00.000Z'),
        scheduleTimezone: 'Asia/Tokyo',
        recurrenceType: 'once',
        messageFormat: 'text',
        publishAnnouncement: false,
      },
      {
        scheduleId: 'b',
        channelId: '123',
        title: 'B',
        scheduledAt: new Date('2026-08-20T09:00:30.000Z'),
        scheduleTimezone: 'UTC',
        recurrenceType: 'daily',
        messageFormat: 'embed',
        publishAnnouncement: true,
      },
      {
        scheduleId: 'c',
        channelId: '999',
        title: 'C',
        scheduledAt: new Date('2026-08-20T09:00:10.000Z'),
        scheduleTimezone: 'UTC',
        recurrenceType: 'weekly',
        messageFormat: 'text',
        publishAnnouncement: false,
      },
    ],
    { year: 2026, month: 8, key: '2026-08' },
    'UTC',
  );

  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.dateKey, '2026-08-20');
  assert.equal(entries[0]?.timeLabel, '09:00');
  assert.equal(entries[0]?.conflictCount, 2);
  assert.equal(entries[1]?.conflictCount, 1);
  assert.equal(entries[2]?.conflictCount, 2);
});

test('対象月外のoccurrenceは表示しない', () => {
  const entries = buildMessageStudioCalendarEntries(
    [
      {
        scheduleId: 'a',
        channelId: '123',
        title: 'A',
        scheduledAt: new Date('2026-09-01T00:00:00.000Z'),
        scheduleTimezone: 'UTC',
        recurrenceType: 'once',
        messageFormat: 'text',
        publishAnnouncement: false,
      },
    ],
    { year: 2026, month: 8, key: '2026-08' },
    'UTC',
  );
  assert.deepEqual(entries, []);
});

test('月の日数と先頭曜日を生成する', () => {
  const month = { year: 2026, month: 8, key: '2026-08' };
  const days = buildMessageStudioCalendarDays(month);
  assert.equal(days.length, 31);
  assert.equal(days[0]?.dateKey, '2026-08-01');
  assert.equal(days[30]?.dateKey, '2026-08-31');
  assert.equal(firstWeekdayOfMessageStudioCalendarMonth(month), 6);
});
