import { describe, expect, it } from 'vitest';
import { rejectIncompleteLocalVcRecap } from './vc-recap-local-finish-policy.js';

describe('Local Whisper stop safety', () => {
  it('rejects a partial or failed local result before sending a summary', () => {
    expect(rejectIncompleteLocalVcRecap(true, false, false)).toBe(true);
    expect(rejectIncompleteLocalVcRecap(true, true, true)).toBe(true);
    expect(rejectIncompleteLocalVcRecap(true, false, true)).toBe(true);
    expect(rejectIncompleteLocalVcRecap(true, true, false)).toBe(false);
  });

  it('preserves AWS legacy finish policy', () => {
    expect(rejectIncompleteLocalVcRecap(false, false, true)).toBe(false);
  });
});
