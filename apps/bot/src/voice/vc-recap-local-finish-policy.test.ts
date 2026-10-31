import { describe, expect, it } from 'vitest';
import {
  markLocalVcRecapPrerequisiteFailure,
  rejectIncompleteLocalVcRecap,
  shouldMarkLocalWhisperSessionFailed,
} from './vc-recap-local-finish-policy.js';

describe('Local Whisper stop safety', () => {
  it('rejects a partial or failed local result before sending a summary', () => {
    expect(rejectIncompleteLocalVcRecap(true, false, false)).toBe(true);
    expect(rejectIncompleteLocalVcRecap(true, true, true)).toBe(true);
    expect(rejectIncompleteLocalVcRecap(true, false, true)).toBe(true);
    expect(rejectIncompleteLocalVcRecap(true, true, false)).toBe(false);
  });

  it('continues other participants after an explicit refusal or cancellation', () => {
    expect(shouldMarkLocalWhisperSessionFailed(true, false)).toBe(false);
    expect(shouldMarkLocalWhisperSessionFailed(false, true)).toBe(false);
    expect(shouldMarkLocalWhisperSessionFailed(true, true)).toBe(false);
    expect(shouldMarkLocalWhisperSessionFailed(false, false)).toBe(true);
  });

  it('prevents successful local summaries after unexpected pre-transcription DB failures', () => {
    const local = { localWhisperFailure: false };
    markLocalVcRecapPrerequisiteFailure(true, local);
    expect(local.localWhisperFailure).toBe(true);
    expect(rejectIncompleteLocalVcRecap(true, true, local.localWhisperFailure)).toBe(true);

    // Explicit refusal causes an ordinary early return rather than invoking
    // the failure helper; all other consenting participants can still finish.
    const denied = { localWhisperFailure: false };
    expect(rejectIncompleteLocalVcRecap(true, true, denied.localWhisperFailure)).toBe(false);

    const aws = { localWhisperFailure: false };
    markLocalVcRecapPrerequisiteFailure(false, aws);
    expect(aws.localWhisperFailure).toBe(false);
  });

  it('preserves AWS legacy finish policy', () => {
    expect(rejectIncompleteLocalVcRecap(false, false, true)).toBe(false);
  });
});
