import type { PrismaClient } from '@herta/db';
import { getUserDataConsent, setVoiceTranscriptionConsent } from '@herta/db';

/**
 * Studioコンソールから管理者がメンバーの同意状態を付与・取消する。
 * 同意はguild非依存のグローバル設定(UserDataConsent)だが、audit logには
 * 「どのguild管理画面から操作したか」を記録する(操作対象自体はguildに紐づかない
 * ため、metadata.scope: 'global'で明示する)。
 */
export async function setVoiceConsentAsAdmin(
  prisma: PrismaClient,
  input: { guildId: string; actorId: string; userId: string; consent: boolean },
): Promise<void> {
  const previous = await getUserDataConsent(prisma, input.userId);
  await setVoiceTranscriptionConsent(prisma, input.userId, input.consent);
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
