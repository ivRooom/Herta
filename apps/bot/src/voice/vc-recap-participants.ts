export interface VcRecapParticipantSplit {
  consentingUserIds: string[];
  nonConsentingUserIds: string[];
}

/**
 * VC参加者を同意者/非同意者へ振り分ける純粋関数。同意していない(またはレコードが無い)
 * ユーザーはnonConsentingへ入り、音声ストリームの購読対象から除外される。
 */
export function splitVcRecapParticipants(
  memberUserIds: readonly string[],
  consentByUserId: ReadonlyMap<string, boolean>,
): VcRecapParticipantSplit {
  const consentingUserIds: string[] = [];
  const nonConsentingUserIds: string[] = [];
  for (const userId of memberUserIds) {
    if (consentByUserId.get(userId) === true) {
      consentingUserIds.push(userId);
    } else {
      nonConsentingUserIds.push(userId);
    }
  }
  return { consentingUserIds, nonConsentingUserIds };
}
