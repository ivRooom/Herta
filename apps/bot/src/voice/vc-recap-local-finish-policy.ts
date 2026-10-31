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
