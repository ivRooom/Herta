import { describe, expect, it } from 'vitest';
import {
  dailyContentIdempotencyKey,
  formatDailyOccurrence,
  nextContentOccurrence,
  nextDailyOccurrence,
  nextWeeklyOccurrence,
  parseLocalDateTime,
} from './schedule.js';

describe('nextDailyOccurrence', () => {
  it('Asia/Tokyoの同日配信時刻をUTCへ変換する', () => {
    const result = nextDailyOccurrence({
      scheduleTime: '10:30',
      timezone: 'Asia/Tokyo',
      after: new Date('2026-07-29T00:00:00.000Z'),
    });
    expect(result.toISOString()).toBe('2026-07-29T01:30:00.000Z');
    expect(formatDailyOccurrence(result, 'Asia/Tokyo')).toBe('2026-07-29 10:30');
  });

  it('DST開始で存在しない時刻は次の日へ送る', () => {
    const result = nextDailyOccurrence({
      scheduleTime: '02:30',
      timezone: 'America/New_York',
      after: new Date('2026-03-08T05:00:00.000Z'),
    });
    expect(result.toISOString()).toBe('2026-03-09T06:30:00.000Z');
  });

  it('DST終了で重複する時刻は同じ現地日に2回配信しない', () => {
    const result = nextDailyOccurrence({
      scheduleTime: '01:30',
      timezone: 'America/New_York',
      after: new Date('2026-11-01T05:45:00.000Z'),
    });
    expect(result.toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });

  it('当日の時刻を過ぎていれば翌日を返す', () => {
    const result = nextDailyOccurrence({
      scheduleTime: '09:00',
      timezone: 'UTC',
      after: new Date('2026-07-29T09:00:00.000Z'),
    });
    expect(result.toISOString()).toBe('2026-07-30T09:00:00.000Z');
  });
});

describe('Message Studio recurrence', () => {
  it('1回予約は未来ならその日時、過去ならnullを返す', () => {
    const onceAt = new Date('2026-08-20T11:00:00.000Z');
    expect(
      nextContentOccurrence({
        recurrenceType: 'once',
        onceAt,
        scheduleTime: '20:00',
        timezone: 'Asia/Tokyo',
        after: new Date('2026-08-19T00:00:00.000Z'),
      }),
    ).toEqual(onceAt);
    expect(
      nextContentOccurrence({
        recurrenceType: 'once',
        onceAt,
        scheduleTime: '20:00',
        timezone: 'Asia/Tokyo',
        after: onceAt,
      }),
    ).toBeNull();
  });

  it('週次は指定した次の曜日だけを返す', () => {
    const result = nextWeeklyOccurrence({
      scheduleTime: '20:00',
      timezone: 'Asia/Tokyo',
      weekdays: [1, 3, 5],
      after: new Date('2026-08-12T12:00:00.000Z'),
    });
    expect(result.toISOString()).toBe('2026-08-14T11:00:00.000Z');
  });

  it('DST終了日の週次配信は1回目の01:30予約後に同日の2回目を返さない', () => {
    const result = nextWeeklyOccurrence({
      scheduleTime: '01:30',
      timezone: 'America/New_York',
      weekdays: [7],
      after: new Date('2026-11-01T05:30:00.000Z'),
    });
    expect(result.toISOString()).toBe('2026-11-08T06:30:00.000Z');
  });

  it('日本時間の予約入力をUTCへ変換する', () => {
    expect(parseLocalDateTime('2026-08-15 20:30', 'Asia/Tokyo').toISOString()).toBe(
      '2026-08-15T11:30:00.000Z',
    );
  });

  it('存在しないDST時刻の1回予約を拒否する', () => {
    expect(() => parseLocalDateTime('2026-03-08 02:30', 'America/New_York')).toThrow(
      '指定した現地時刻はtimezone上で存在しません',
    );
  });
});

describe('dailyContentIdempotencyKey', () => {
  it('スケジュールと予定時刻から安定したキーを生成する', () => {
    const scheduledFor = new Date('2026-07-29T01:30:00.000Z');
    expect(dailyContentIdempotencyKey('schedule-1', scheduledFor)).toBe(
      'schedule-1:2026-07-29T01:30:00.000Z',
    );
  });
});
