import { describe, expect, it } from 'vitest';
import { ModerationValidationError } from './config.js';
import { normalizeEditableModerationCaseStatus } from './case-lifecycle.js';

describe('normalizeEditableModerationCaseStatus', () => {
  it.each(['active', 'completed', 'revoked'] as const)('%sを許可する', (status) => {
    expect(normalizeEditableModerationCaseStatus(status)).toBe(status);
  });

  it.each([null, '', 'failed', 'unknown'])('編集対象外の状態%jを拒否する', (status) => {
    expect(() => normalizeEditableModerationCaseStatus(status)).toThrow(ModerationValidationError);
  });
});
