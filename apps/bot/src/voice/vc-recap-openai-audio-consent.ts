import type { PrismaClient } from '@herta/db';

/**
 * The version MUST match the deployed consent form describing that raw speech
 * is transmitted to OpenAI, not AWS. No existing 30-day or role consent counts.
 */
export const VC_RECAP_OPENAI_AUDIO_POLICY_VERSION = 'vc-recap-openai-audio-2026-10-31-v1';

/**
 * Explicit opt-in for sending voice audio to OpenAI.
 * New schema is intentionally optional: missing relation, erasure-state
 * failures or unavailable database all produce a DENY (never AWS fallback).
 */
export async function hasVcRecapOpenAiAudioConsent(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM vc_recap_explicit_consents consent
        WHERE consent.user_id = ${userId}
          AND consent.purpose = 'openai_audio_processing'
          AND consent.policy_version = ${VC_RECAP_OPENAI_AUDIO_POLICY_VERSION}
          AND consent.consented_at IS NOT NULL
          AND consent.revoked_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM vc_recap_erasure_requests erasure
            WHERE erasure.user_id = consent.user_id
          )
      ) AS allowed
    `;
    return rows[0]?.allowed === true;
  } catch {
    // No new table or inaccessible erasure fence means explicit opt-in cannot
    // be verified. Fail closed, including on restored/migrating databases.
    return false;
  }
}
