import { describe, expect, it } from 'vitest';
import {
  dailyContentIdempotencyKey,
  formatDailyOccurrence,
  nextDailyOccurrence,
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

  it('DST終了で重複する時刻はafterより後の候補を選ぶ', () => {
    const result = nextDailyOccurrence({
      scheduleTime: '01:30',
      timezone: 'America/New_York',
      after: new Date('2026-11-01T05:45:00.000Z'),
    });
    expect(result.toISOString()).toBe('2026-11-01T06:30:00.000Z');
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

describe('dailyContentIdempotencyKey', () => {
  it('スケジュールと予定時刻から安定したキーを生成する', () => {
    const scheduledFor = new Date('2026-07-29T01:30:00.000Z');
    expect(dailyContentIdempotencyKey('schedule-1', scheduledFor)).toBe(
      'schedule-1:2026-07-29T01:30:00.000Z',
    );
  });
});
