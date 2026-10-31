import type { PrismaClient } from '@prisma/client';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';
import type { AppendVcRecapTranscriptSegmentInput } from './vc-recap.js';

/**
 * Local Whisper: grant, deletion fence, and write happen under the SAME
 * per-owner database transaction lock as consent withdrawal and erasure.
 * No write is permitted with a missing explicit personal grant.
 *
 * Existing AWS / OpenAI behavior is intentionally left unchanged.
 */
export async function appendLocalVcRecapSegmentIfConsented(
  prisma: PrismaClient,
  input: AppendVcRecapTranscriptSegmentInput,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockVcRecapStorageOwner(tx, input.userId);
    const [consent, erasure] = await Promise.all([
      tx.userDataConsent.findUnique({
        where: { userId: input.userId },
        select: { voiceTranscriptionConsent: true, voiceTranscriptRetentionConsentedAt: true },
      }),
      tx.vcRecapErasureRequest.findUnique({
        where: { userId: input.userId },
        select: { userId: true },
      }),
    ]);
    if (
      erasure ||
      consent?.voiceTranscriptionConsent !== true ||
      consent.voiceTranscriptRetentionConsentedAt === null
    ) return false;

    await tx.vcRecapTranscriptSegment.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        text: input.text,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      },
    });
    return true;
  });
}
