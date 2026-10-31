/** A local ASR session must never summarize an unverified partial transcript. */
export function rejectIncompleteLocalVcRecap(
  localCanary: boolean,
  allTranscriptionsFlushed: boolean,
  anyTranscriptionFailed: boolean,
): boolean {
  return localCanary && (!allTranscriptionsFlushed || anyTranscriptionFailed);
}

/** A deliberate personal refusal/withdrawal is not an ASR infrastructure error.
 * A timeout or unexpected inference failure must still invalidate partial results.
 */
export function shouldMarkLocalWhisperSessionFailed(
  consentDenied: boolean,
  explicitlyAborted: boolean,
): boolean {
  return !consentDenied && !explicitlyAborted;
}

/** An unexpected start-time prerequisite error invalidates a local recap.
 * Ordinary refusal returns before this function and is not treated as an error.
 * The existing AWS streaming behavior must not change.
 */
export function markLocalVcRecapPrerequisiteFailure(
  localCanary: boolean,
  state: { localWhisperFailure: boolean },
): void {
  if (localCanary) state.localWhisperFailure = true;
}
