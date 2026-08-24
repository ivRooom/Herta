import { describe, expect, it } from 'vitest';
import {
  DAILY_CONTENT_QUEUE_TRANSPORT_ATTEMPTS,
  canStartDailyContentDeliveryAttempt,
  normalizeDailyContentScanIntervalSeconds,
  redisReconnectDelay,
  resolveDailyContentQueueJobDisposition,
  resolveDailyContentRetryDelayMs,
  shouldRetryDailyContentDelivery,
} from './queue.js';

describe('Daily Content Queue hardening', () => {
  it.each(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'])(
    '既存%s Jobは再投入しない',
    (state) => {
      expect(resolveDailyContentQueueJobDisposition(state)).toBe('keep');
    },
  );

  it.each(['failed', 'completed'])('既存%s Jobは削除して再投入する', (state) => {
    expect(resolveDailyContentQueueJobDisposition(state)).toBe('replace');
  });

  it('Jobが存在しない場合はenqueueする', () => {
    expect(resolveDailyContentQueueJobDisposition(null)).toBe('enqueue');
    expect(resolveDailyContentQueueJobDisposition('unknown')).toBe('enqueue');
  });

  it('BullMQ attemptsをmanifest上限と同じtransport安全上限に固定する', () => {
    expect(DAILY_CONTENT_QUEUE_TRANSPORT_ATTEMPTS).toBe(10);
  });

  it('走査間隔を10〜300秒へ制限する', () => {
    expect(normalizeDailyContentScanIntervalSeconds(undefined)).toBe(30);
    expect(normalizeDailyContentScanIntervalSeconds('1')).toBe(10);
    expect(normalizeDailyContentScanIntervalSeconds('60')).toBe(60);
    expect(normalizeDailyContentScanIntervalSeconds('999')).toBe(300);
  });

  it('Redis再接続delayを段階的に増やし30秒で上限化する', () => {
    expect(redisReconnectDelay(1)).toBe(500);
    expect(redisReconnectDelay(10)).toBe(5000);
    expect(redisReconnectDelay(100)).toBe(30000);
  });
});

describe('Daily Content domain retry policy', () => {
  it.each([
    { attemptCount: 0, maxAttempts: 2, expected: true },
    { attemptCount: 1, maxAttempts: 2, expected: true },
    { attemptCount: 2, maxAttempts: 2, expected: false },
    { attemptCount: 5, maxAttempts: 2, expected: false },
  ])(
    'maxAttemptsを5→2へ減らした場合もattemptCount=$attemptCountの開始可否を現在値で判定する',
    ({ attemptCount, maxAttempts, expected }) => {
      expect(canStartDailyContentDeliveryAttempt(attemptCount, maxAttempts)).toBe(expected);
    },
  );

  it('maxAttempts=1では初回だけ開始できる', () => {
    expect(canStartDailyContentDeliveryAttempt(0, 1)).toBe(true);
    expect(canStartDailyContentDeliveryAttempt(1, 1)).toBe(false);
  });

  it('schema最大値10の境界を正しく扱う', () => {
    expect(canStartDailyContentDeliveryAttempt(9, 10)).toBe(true);
    expect(canStartDailyContentDeliveryAttempt(10, 10)).toBe(false);
  });

  it('maxAttempts減少後は現在設定を超える自動retryを予約しない', () => {
    expect(shouldRetryDailyContentDelivery(1, 2, true)).toBe(true);
    expect(shouldRetryDailyContentDelivery(2, 2, true)).toBe(false);
    expect(shouldRetryDailyContentDelivery(3, 2, true)).toBe(false);
  });

  it('maxAttemptsを2→5へ増やした場合は旧BullMQ attemptsに依存せずretry余地を認識する', () => {
    expect(shouldRetryDailyContentDelivery(2, 5, true)).toBe(true);
    expect(shouldRetryDailyContentDelivery(4, 5, true)).toBe(true);
    expect(shouldRetryDailyContentDelivery(5, 5, true)).toBe(false);
  });

  it('非retryableエラーは残り試行回数に関係なくretryしない', () => {
    expect(shouldRetryDailyContentDelivery(1, 5, false)).toBe(false);
  });

  it('retry backoffをBullMQ attemptsMadeではなくdelivery総試行回数から計算する', () => {
    expect(resolveDailyContentRetryDelayMs(1, 15_000)).toBe(15_000);
    expect(resolveDailyContentRetryDelayMs(2, 15_000)).toBe(30_000);
    expect(resolveDailyContentRetryDelayMs(3, 15_000)).toBe(60_000);
    expect(resolveDailyContentRetryDelayMs(5, 15_000)).toBe(240_000);
  });
});
