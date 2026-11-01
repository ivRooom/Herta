import type { PrismaClient } from '@prisma/client';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';

/**
 * A proposed version. It MUST be updated to the actually published policy
 * before enabling ingestion. The consent table is initially empty (fail closed).
 */
export const VC_RECAP_LONG_TERM_CONSENT_VERSION = 'vc-recap-comprehensive-2026-11-01-v1';

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

const LONG_TERM_PURPOSES = ['transcription', 'transcript_long_term', 'audio_long_term'] as const;

/** All three purposes come from the same affirmative policy action; partial legacy rows deny. */
// prettier-ignore
export function hasVcRecapComprehensiveConsent(
  records: readonly VcRecapExplicitConsentRecord[],
  policyVersion = VC_RECAP_LONG_TERM_CONSENT_VERSION,
): boolean {
  const grants = LONG_TERM_PURPOSES.map((purpose) =>
    records.find((row) => row.purpose === purpose && row.policyVersion === policyVersion && row.consentedAt !== null && row.revokedAt === null),
  );
  if (grants.some((grant) => !grant)) return false;
  const issuedAt = grants[0]?.consentedAt?.getTime();
  return issuedAt !== undefined && grants.every((grant) => grant?.consentedAt?.getTime() === issuedAt);
}

export interface VcRecapConsentCapabilities {
  canTranscribe: boolean;
  canRetainTranscriptLongTerm: boolean;
  canRecordAudioLongTerm: boolean;
}

/** Pure evaluation with no implicit inherited consent. Explicit legacy refusal wins. */
// prettier-ignore
export function evaluateVcRecapExplicitConsent(
  records: readonly VcRecapExplicitConsentRecord[],
  hasLegacyExplicitRefusal: boolean,
  policyVersion = VC_RECAP_LONG_TERM_CONSENT_VERSION,
): VcRecapConsentCapabilities {
  const granted = !hasLegacyExplicitRefusal && hasVcRecapComprehensiveConsent(records, policyVersion);
  return {
    canTranscribe: granted,
    canRetainTranscriptLongTerm: granted,
    canRecordAudioLongTerm: granted,
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
    await lockVcRecapStorageOwner(tx, userId);
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
    // Serialize OpenAI processing consent with erasure requests and future
    // storage reservations for the same owner. A concurrent delete must not
    // race between the fence read and an affirmative consent upsert.
    await lockVcRecapStorageOwner(tx, userId);
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
export function isVcRecapLongTermEnrollmentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
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

export interface VcRecapLongTermConsentView {
  choices: VcRecapLongTermChoices;
  legacyConsent: boolean;
  erasurePending: boolean;
  hasUnrevokedLongTermGrant: boolean;
  enrollmentEnabled: boolean;
}

// prettier-ignore
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
  const granted =
    erasure === null &&
    legacy?.voiceTranscriptionConsent === true &&
    hasVcRecapComprehensiveConsent(records);
  return {
    choices: {
      transcription: granted,
      transcriptLongTerm: granted,
      audioLongTerm: granted,
    },
    legacyConsent: legacy?.voiceTranscriptionConsent ?? false,
    erasurePending: erasure !== null,
    // Version migration must not hide a prior unrevoked grant from withdrawal.
    hasUnrevokedLongTermGrant: records.some(
      (record) => record.consentedAt !== null && record.revokedAt === null,
    ),
    enrollmentEnabled: isVcRecapLongTermEnrollmentEnabled(),
  };
}

export type VcRecapLongTermConsentUpdateResult =
  'updated' | 'erasure_requested' | 'erasure_pending' | 'enrollment_disabled' | 'invalid';

/**
 * A single affirmative privacy-policy action covers all three future purposes.
 * The legacy three-boolean primitive is kept for type-compatibility only:
 * mixed/partial grants fail closed and must never reach persistence.
 *
 * Withdrawals revoke both the future purposes and the current 30-day voice
 * transcript consent, insert a durable erasure fence and delete legacy text
 * in one owner-locked transaction. The fence remains until independently
 * verified deletion: a new click cannot silently erase it.
 */
// prettier-ignore
export async function updateVcRecapLongTermConsentChoices(
  prisma: PrismaClient,
  userId: string,
  choices: VcRecapLongTermChoices,
): Promise<VcRecapLongTermConsentUpdateResult> {
  if (
    choices.transcription !== choices.transcriptLongTerm ||
    choices.transcription !== choices.audioLongTerm
  ) return 'invalid';
  const wantsGrant = choices.transcription;
  return prisma.$transaction(async (tx) => {
    await lockVcRecapStorageOwner(tx, userId);
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
    if (!wantsGrant) {
      const hadConsent =
        legacy?.voiceTranscriptionConsent === true ||
        existing.some((row) => row.consentedAt !== null && row.revokedAt === null);
      if (!hadConsent) {
        // A first-time refusal must be durable: auto-consent roles only apply to absent choices.
        // There are no previously retained objects to erase, so no deletion tombstone is needed.
        await tx.userDataConsent.upsert({
          where: { userId },
          create: { userId, voiceTranscriptionConsent: false, voiceTranscriptRetentionConsentedAt: null },
          update: { voiceTranscriptionConsent: false, voiceTranscriptRetentionConsentedAt: null },
        });
        return 'updated';
      }
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
      await tx.userDataConsent.upsert({
        where: { userId },
        create: { userId, voiceTranscriptionConsent: false, voiceTranscriptRetentionConsentedAt: null },
        update: { voiceTranscriptionConsent: false, voiceTranscriptRetentionConsentedAt: null },
      });
      await tx.vcRecapTranscriptSegment.deleteMany({ where: { userId } });
      return 'erasure_requested';
    }
    if (!isVcRecapLongTermEnrollmentEnabled()) return 'enrollment_disabled';
    const now = new Date();
    await tx.userDataConsent.upsert({
      where: { userId },
      create: {
        userId,
        voiceTranscriptionConsent: true,
        voiceTranscriptRetentionConsentedAt: now,
      },
      update: {
        voiceTranscriptionConsent: true,
        voiceTranscriptRetentionConsentedAt: now,
      },
    });
    for (const purpose of LONG_TERM_PURPOSES) {
      await tx.vcRecapExplicitConsent.upsert({
        where: { userId_purpose: { userId, purpose } },
        create: {
          userId,
          purpose,
          policyVersion: VC_RECAP_LONG_TERM_CONSENT_VERSION,
          consentedAt: now,
          revokedAt: null,
        },
        update: {
          policyVersion: VC_RECAP_LONG_TERM_CONSENT_VERSION,
          consentedAt: now,
          revokedAt: null,
        },
      });
    }
    return 'updated';
  });
}

/** The UI/API exposes only one accepted boolean, not three independent choices. */
// prettier-ignore
export async function updateVcRecapComprehensiveConsent(
  prisma: PrismaClient,
  userId: string,
  accepted: boolean,
): Promise<VcRecapLongTermConsentUpdateResult> {
  return updateVcRecapLongTermConsentChoices(prisma, userId, {
    transcription: accepted,
    transcriptLongTerm: accepted,
    audioLongTerm: accepted,
  });
}
