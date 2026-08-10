import { afterEach, describe, expect, it } from 'vitest';
import { ModerationValidationError } from './config.js';
import {
  beginModerationTargetOperation,
  resetModerationTargetOperationsForTest,
} from './target-operation-lock.js';

afterEach(() => {
  resetModerationTargetOperationsForTest();
});

describe('beginModerationTargetOperation', () => {
  it('同一Guild・同一ユーザーの同時操作を拒否する', () => {
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
});
