import type { PrismaClient } from '@herta/db';
import {
  getUserDataConsent,
  grantVoiceTranscriptionConsentUnlessRefused,
  setVoiceTranscriptionConsent,
} from '@herta/db';

export class VoiceConsentRefusedError extends Error {
  constructor() {
    super('本人がVC文字起こしを拒否・取り消ししているため、管理者は同意済みにできません');
    this.name = 'VoiceConsentRefusedError';
  }
}

/**
 * Studioコンソールから管理者がメンバーの同意状態を付与・取消する。
 * 本人の拒否を優先するため、本人(または本人の依頼による取消)で拒否が記録されている
 * メンバーを管理者が同意済みにすることはできない(VoiceConsentRefusedError)。
 * 付与できるのは一度も同意・拒否を選んでいないメンバーだけ。
 * 同意はguild非依存のグローバル設定(UserDataConsent)だが、audit logには
 * 「どのguild管理画面から操作したか」を記録する(操作対象自体はguildに紐づかない
 * ため、metadata.scope: 'global'で明示する)。
 */
export async function setVoiceConsentAsAdmin(
  prisma: PrismaClient,
  input: { guildId: string; actorId: string; userId: string; consent: boolean },
): Promise<void> {
  const previous = await getUserDataConsent(prisma, input.userId);
  if (input.consent) {
    // 付与は拒否を上書きしない条件付きの書き込みで行う。事前の読み取りの後に本人が
    // 拒否した場合も、ここでnullが返り409になる。
    if (hasExplicitRefusal(previous)) throw new VoiceConsentRefusedError();
    const granted = await grantVoiceTranscriptionConsentUnlessRefused(prisma, input.userId);
    if (!granted) throw new VoiceConsentRefusedError();
  } else {
    await setVoiceTranscriptionConsent(prisma, input.userId, false);
  }
  await prisma.auditLog.create({
    data: {
      guildId: input.guildId,
      actorId: input.actorId,
      event: input.consent ? 'voice_consent.granted' : 'voice_consent.revoked',
      targetType: 'user_data_consent',
      targetId: input.userId,
      severity: 'info',
      changes: {
        before: { voiceTranscriptionConsent: previous.voiceTranscriptionConsent },
        after: { voiceTranscriptionConsent: input.consent },
      },
      metadata: { scope: 'global' },
    },
  });
}

/** getUserDataConsentはレコードが無いとupdatedAt=epochを返す(一度も選んでいない状態)。 */
function hasExplicitRefusal(state: { voiceTranscriptionConsent: boolean; updatedAt: Date }) {
  return !state.voiceTranscriptionConsent && state.updatedAt.getTime() > 0;
}
