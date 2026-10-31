/** A local ASR session must never summarize an unverified partial transcript. */
export function rejectIncompleteLocalVcRecap(
  localCanary: boolean,
  allTranscriptionsFlushed: boolean,
  anyTranscriptionFailed: boolean,
): boolean {
  return localCanary && (!allTranscriptionsFlushed || anyTranscriptionFailed);
}
