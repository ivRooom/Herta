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
  'openai_audio_processing',
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

/** Raw-audio disclosure consent is independent from the legacy AWS-only setting. */
export const VC_RECAP_OPENAI_AUDIO_POLICY_VERSION = 'vc-recap-openai-audio-2026-10-31-v1';

/**
 * Record a participant's affirmative, versioned consent for sending raw voice
 * to OpenAI. A previous erasure request cannot be silently overridden.
 *
 * This is the write primitive; callers must show the complete current
 * processor disclosure BEFORE requesting the user's affirmative action.
 */
export async function setVcRecapOpenAiAudioConsent(
  prisma: PrismaClient,
  userId: string,
  accepted: boolean,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const [legacy, erasure] = await Promise.all([
      tx.userDataConsent.findUnique({
        where: { userId },
        select: { voiceTranscriptionConsent: true },
      }),
      tx.vcRecapErasureRequest.findUnique({
        where: { userId },
        select: { userId: true },
      }),
    ]);
    // Refuse granting new processing rights without an active personal
    // transcription consent or while deletion of prior records is pending.
    if (accepted && (!legacy?.voiceTranscriptionConsent || erasure !== null)) {
      return false;
    }
    const now = new Date();
    await tx.vcRecapExplicitConsent.upsert({
      where: { userId_purpose: { userId, purpose: 'openai_audio_processing' } },
      create: {
        userId,
        purpose: 'openai_audio_processing',
        policyVersion: VC_RECAP_OPENAI_AUDIO_POLICY_VERSION,
        consentedAt: accepted ? now : null,
        revokedAt: accepted ? null : now,
      },
      update: {
        policyVersion: VC_RECAP_OPENAI_AUDIO_POLICY_VERSION,
        consentedAt: accepted ? now : null,
        revokedAt: accepted ? null : now,
      },
    });
    return true;
  });
}

/**
 * The long-term plan is NOT the currently published privacy policy.
 * Enrollment stays fail-closed until operators verify and publish the exact
 * policy version and enable enrollment as a separate deployment gate.
 */
export function isVcRecapLongTermEnrollmentEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'] === 'true' &&
    env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'] === VC_RECAP_LONG_TERM_CONSENT_VERSION
  );
}

export interface VcRecapLongTermChoices {
  transcription: boolean;
  transcriptLongTerm: boolean;
  audioLongTerm: boolean;
}

const LONG_TERM_PURPOSES = [
  'transcription',
  'transcript_long_term',
  'audio_long_term',
] as const;

export interface VcRecapLongTermConsentView {
  choices: VcRecapLongTermChoices;
  legacyConsent: boolean;
  erasurePending: boolean;
  enrollmentEnabled: boolean;
}

export async function getVcRecapLongTermConsentView(
  prisma: PrismaClient,
  userId: string,
): Promise<VcRecapLongTermConsentView> {
  const [records, legacy, erasure] = await Promise.all([
    prisma.vcRecapExplicitConsent.findMany({
      where: { userId, purpose: { in: [...LONG_TERM_PURPOSES] } },
      select: { purpose: true, policyVersion: true, consentedAt: true, revokedAt: true },
    }),
    prisma.userDataConsent.findUnique({
      where: { userId },
      select: { voiceTranscriptionConsent: true },
    }),
    prisma.vcRecapErasureRequest.findUnique({ where: { userId }, select: { userId: true } }),
  ]);
  const allowed = (purpose: (typeof LONG_TERM_PURPOSES)[number]) =>
    erasure === null &&
    records.some(
      (record) =>
        record.purpose === purpose &&
        record.policyVersion === VC_RECAP_LONG_TERM_CONSENT_VERSION &&
        record.consentedAt !== null &&
        record.revokedAt === null,
    );
  return {
    choices: {
      transcription: allowed('transcription'),
      transcriptLongTerm: allowed('transcript_long_term'),
      audioLongTerm: allowed('audio_long_term'),
    },
    legacyConsent: legacy?.voiceTranscriptionConsent ?? false,
    erasurePending: erasure !== null,
    enrollmentEnabled: isVcRecapLongTermEnrollmentEnabled(),
  };
}

export type VcRecapLongTermConsentUpdateResult =
  | 'updated'
  | 'erasure_requested'
  | 'erasure_pending'
  | 'legacy_consent_required'
  | 'enrollment_disabled'
  | 'invalid';

/**
 * Separate, affirmative choices for the three new processing purposes.
 * Legacy consent is never migrated or copied here.
 *
 * Withdrawal of any previously granted long-term purpose creates a durable
 * erasure barrier and revokes ALL future-purpose grants. Re-enrollment is
 * blocked while that barrier exists; it is not cleared by a new click.
 * No storage deletion is claimed until a dedicated worker verifies it.
 */
export async function updateVcRecapLongTermConsentChoices(
  prisma: PrismaClient,
  userId: string,
  choices: VcRecapLongTermChoices,
): Promise<VcRecapLongTermConsentUpdateResult> {
  if (choices.transcriptLongTerm && !choices.transcription) return 'invalid';
  const requested = {
    transcription: choices.transcription,
    transcript_long_term: choices.transcriptLongTerm,
    audio_long_term: choices.audioLongTerm,
  } as const;
  const wantsGrant = Object.values(requested).some(Boolean);
  // Revocation must remain possible even when enrollment is disabled.
  if (wantsGrant && !isVcRecapLongTermEnrollmentEnabled()) return 'enrollment_disabled';

  return prisma.$transaction(async (tx) => {
    const [erasure, legacy, existing] = await Promise.all([
      tx.vcRecapErasureRequest.findUnique({ where: { userId }, select: { userId: true } }),
      tx.userDataConsent.findUnique({
        where: { userId },
        select: { voiceTranscriptionConsent: true },
      }),
      tx.vcRecapExplicitConsent.findMany({
        where: { userId, purpose: { in: [...LONG_TERM_PURPOSES] } },
        select: { purpose: true, policyVersion: true, consentedAt: true, revokedAt: true },
      }),
    ]);
    if (erasure !== null) return 'erasure_pending';
    const active = (purpose: string) =>
      existing.some(
        (row) => row.purpose === purpose && row.consentedAt !== null && row.revokedAt === null,
      );
    const withdrawing = LONG_TERM_PURPOSES.some((purpose) => active(purpose) && !requested[purpose]);
    if (withdrawing) {
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
      return 'erasure_requested';
    }
    if (wantsGrant && !legacy?.voiceTranscriptionConsent) return 'legacy_consent_required';
    for (const purpose of LONG_TERM_PURPOSES) {
      if (!requested[purpose]) continue;
      await tx.vcRecapExplicitConsent.upsert({
        where: { userId_purpose: { userId, purpose } },
        create: {
          userId,
          purpose,
          policyVersion: VC_RECAP_LONG_TERM_CONSENT_VERSION,
          consentedAt: new Date(),
          revokedAt: null,
        },
        update: {
          policyVersion: VC_RECAP_LONG_TERM_CONSENT_VERSION,
          consentedAt: new Date(),
          revokedAt: null,
        },
      });
    }
    return 'updated';
  });
}
