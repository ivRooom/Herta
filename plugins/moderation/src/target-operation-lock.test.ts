import { afterEach, describe, expect, it } from 'vitest';
import { ModerationValidationError } from './config.js';
import {
  beginModerationTargetOperation,
  resetModerationTargetOperationsForTest,
  waitForModerationTargetOperation,
} from './target-operation-lock.js';

afterEach(() => {
  resetModerationTargetOperationsForTest();
});

describe('Moderation target operation lock', () => {
  it('同一Guild・同一ユーザーの手動同時操作を拒否する', () => {
    const release = beginModerationTargetOperation('100', '200');

    expect(() => beginModerationTargetOperation('100', '200')).toThrow(ModerationValidationError);
    release();
    expect(() => beginModerationTargetOperation('100', '200')).not.toThrow();
  });

  it('異なる対象ユーザーは並行して操作できる', () => {
    expect(() => beginModerationTargetOperation('100', '200')).not.toThrow();
    expect(() => beginModerationTargetOperation('100', '201')).not.toThrow();
  });

  it('releaseを複数回呼んでも安全に解放する', () => {
    const release = beginModerationTargetOperation('100', '200');
    release();
    release();

    expect(() => beginModerationTargetOperation('100', '200')).not.toThrow();
  });

  it('自動操作は先行する手動操作の解放まで待機する', async () => {
    const releaseManual = beginModerationTargetOperation('100', '200');
    let acquired = false;
    const automatic = waitForModerationTargetOperation('100', '200').then((release) => {
      acquired = true;
      release();
    });

    await Promise.resolve();
    expect(acquired).toBe(false);

    releaseManual();
    await automatic;
    expect(acquired).toBe(true);
  });

  it('複数の自動操作へロック所有権を順番に渡す', async () => {
    const releaseFirst = await waitForModerationTargetOperation('100', '200');
    const order: number[] = [];
    const second = waitForModerationTargetOperation('100', '200').then((release) => {
      order.push(2);
      release();
    });
    const third = waitForModerationTargetOperation('100', '200').then((release) => {
      order.push(3);
      release();
    });

    releaseFirst();
    await Promise.all([second, third]);
    expect(order).toEqual([2, 3]);
  });
});
