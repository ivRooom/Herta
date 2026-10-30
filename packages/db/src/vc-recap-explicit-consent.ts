import type { PrismaClient } from '@prisma/client';

/**
 * A proposed version. It MUST be updated to the actually published policy
 * before enabling ingestion. The consent table is initially empty (fail closed).
 */
export const VC_RECAP_LONG_TERM_CONSENT_VERSION = 'vc-recap-long-term-2026-10-30-v1';

export const VC_RECAP_CONSENT_PURPOSES = [
  'transcription',
  'transcript_long_term',
  'audio_long_term',
] as const;
export type VcRecapConsentPurpose = (typeof VC_RECAP_CONSENT_PURPOSES)[number];

export interface VcRecapExplicitConsentRecord {
  purpose: string;
  policyVersion: string;
  consentedAt: Date | null;
  revokedAt: Date | null;
}

export interface VcRecapConsentCapabilities {
  canTranscribe: boolean;
  canRetainTranscriptLongTerm: boolean;
  canRecordAudioLongTerm: boolean;
}

/** Pure evaluation with no implicit inherited consent. Explicit legacy refusal wins. */
export function evaluateVcRecapExplicitConsent(
  records: readonly VcRecapExplicitConsentRecord[],
  hasLegacyExplicitRefusal: boolean,
  policyVersion = VC_RECAP_LONG_TERM_CONSENT_VERSION,
): VcRecapConsentCapabilities {
  const allowed = (purpose: VcRecapConsentPurpose) =>
    !hasLegacyExplicitRefusal &&
    records.some(
      (record) =>
        record.purpose === purpose &&
        record.policyVersion === policyVersion &&
        record.consentedAt !== null &&
        record.revokedAt === null,
    );
  const canTranscribe = allowed('transcription');
  return {
    canTranscribe,
    canRetainTranscriptLongTerm: canTranscribe && allowed('transcript_long_term'),
    canRecordAudioLongTerm: allowed('audio_long_term'),
  };
}

/**
 * Read-only gate for future recorder/archiver. Nothing calls this to enable
 * new storage in the current release. Missing/mismatched consent is DENY.
 */
export async function getVcRecapExplicitConsentCapabilities(
  prisma: PrismaClient,
  userId: string,
): Promise<VcRecapConsentCapabilities> {
  const [records, legacy, erasure] = await Promise.all([
    prisma.vcRecapExplicitConsent.findMany({
      where: { userId },
      select: { purpose: true, policyVersion: true, consentedAt: true, revokedAt: true },
    }),
    prisma.userDataConsent.findUnique({
      where: { userId },
      select: { voiceTranscriptionConsent: true, updatedAt: true },
    }),
    prisma.vcRecapErasureRequest.findUnique({
      where: { userId },
      select: { userId: true },
    }),
  ]);
  const legacyRefusal =
    legacy !== null && !legacy.voiceTranscriptionConsent && legacy.updatedAt.getTime() > 0;
  return evaluateVcRecapExplicitConsent(records, legacyRefusal || erasure !== null);
}

/**
 * Persist a deletion barrier and revoke every future-purpose consent atomically.
 * This does NOT claim to have deleted S3 objects. The erasure request stays
 * active until a future archive worker verifies all object versions and backup
 * restore replay. Callers must still delete legacy PostgreSQL VC data.
 */
export async function requestVcRecapErasure(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.vcRecapErasureRequest.upsert({
      where: { userId },
      create: { userId, requestedAt: now },
      update: { requestedAt: now, storageDeletionVerifiedAt: null },
    });
    await tx.vcRecapExplicitConsent.updateMany({
      where: { userId },
      data: { consentedAt: null, revokedAt: now },
    });
  });
}
