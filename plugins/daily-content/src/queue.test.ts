import { describe, expect, it } from 'vitest';
import {
  normalizeDailyContentScanIntervalSeconds,
  redisReconnectDelay,
  resolveDailyContentQueueJobDisposition,
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
