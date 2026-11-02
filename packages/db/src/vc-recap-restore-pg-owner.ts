import type { PrismaClient } from '@prisma/client';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';

const RUN_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OWNER_ID = /^\d{15,22}$/;
const UTC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;

export interface VcRecapRestoreFenceWrite {
  userId: string;
  requestedAt: string;
  storageDeletionVerifiedAt: null;
  revokeLegacyConsent: true;
  revokeAllPurposeConsents: true;
  cancelPendingWrites: true;
}

export interface VcRecapRestoreFenceProof {
  userId: string;
  requestedAt: string;
  storageDeletionVerifiedAt: null | string;
  legacyConsentRevoked: boolean;
  purposeConsentsRevoked: boolean;
  pendingWritesCancelled: boolean;
}

export interface VcRecapRestorePgOwnerPort {
  readFence(): Promise<{ requestedAt: string } | null>;
  upsertFenceAndRevoke(payload: VcRecapRestoreFenceWrite): Promise<void>;
  verifyFenceAndRevocations(): Promise<VcRecapRestoreFenceProof>;
}

/**
 * The live schema stores Timestamptz(3) and Prisma Date supports milliseconds.
 * Reject nonzero sub-millisecond precision instead of silently truncating a
 * later external erasure request. A schema/protocol migration is required for
 * the microsecond-complete #729 requirement.
 */
export function parseVcRecapPgFenceTimestamp(value: string): Date {
  if (typeof value !== 'string') throw new Error('Unsupported restore timestamp');
  const match = UTC.exec(value);
  if (!match || (match[2] ?? '').padEnd(6, '0').slice(3) !== '000') {
    throw new Error('Unsupported restore timestamp precision');
  }
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== match[1]
  ) {
    throw new Error('Invalid restore timestamp');
  }
  return parsed;
}

/**
 * Unwired real-PostgreSQL adapter for the OFFLINE restore-fence replay port.
 * A separate, independently authenticated ledger and durable quarantine
 * MUST be established by the caller before entering this transaction.
 *
 * The adapter does not delete remote S3 versions, attest to erase completion,
 * or permit any traffic to resume. It is intentionally not imported by Bot,
 * API, Studio or Worker. Run only in an explicitly isolated throwaway PG test.
 */
export async function withVcRecapRestorePgOwnerTransaction(
  prisma: PrismaClient,
  runId: string,
  userId: string,
  callback: (port: VcRecapRestorePgOwnerPort) => Promise<void>,
): Promise<void> {
  if (!RUN_ID.test(runId) || !OWNER_ID.test(userId) || typeof callback !== 'function') {
    throw new Error('Invalid restore transaction context');
  }
  let syntheticStage = 'before transaction';
  try {
    await prisma.$transaction(
      async (tx) => {
        syntheticStage = 'acquire lock';
        await lockVcRecapStorageOwner(tx, userId);
        const port: VcRecapRestorePgOwnerPort = {
          async readFence() {
            syntheticStage = 'read fence';
            const fence = await tx.vcRecapErasureRequest.findUnique({
              where: { userId },
              select: { requestedAt: true },
            });
            return fence ? { requestedAt: fence.requestedAt.toISOString() } : null;
          },
          async upsertFenceAndRevoke(payload) {
            if (
              payload.userId !== userId ||
              payload.storageDeletionVerifiedAt !== null ||
              payload.revokeLegacyConsent !== true ||
              payload.revokeAllPurposeConsents !== true ||
              payload.cancelPendingWrites !== true
            ) {
              throw new Error('Invalid owner fence operation');
            }
            syntheticStage = 'validate timestamp';
            const incoming = parseVcRecapPgFenceTimestamp(payload.requestedAt);
            syntheticStage = 'find existing fence';
            const existing = await tx.vcRecapErasureRequest.findUnique({
              where: { userId },
              select: { requestedAt: true },
            });
            // Never move an existing fence backwards even on a second replay.
            const latest =
              existing && existing.requestedAt.getTime() > incoming.getTime()
                ? existing.requestedAt
                : incoming;
            const revokedAt = new Date();
            syntheticStage = 'upsert fence';
            await tx.vcRecapErasureRequest.upsert({
              where: { userId },
              create: { userId, requestedAt: latest, storageDeletionVerifiedAt: null },
              update: { requestedAt: latest, storageDeletionVerifiedAt: null },
            });
            syntheticStage = 'revoke legacy';
            await tx.userDataConsent.updateMany({
              where: { userId },
              data: {
                voiceTranscriptionConsent: false,
                voiceTranscriptRetentionConsentedAt: null,
              },
            });
            // Includes all three future purposes and OpenAI processing consent.
            syntheticStage = 'revoke purposes';
            await tx.vcRecapExplicitConsent.updateMany({
              where: { userId },
              data: { consentedAt: null, revokedAt },
            });
            // Do not invent an invalid state: the live DB CHECK permits only
            // 'reserved'/'committed'. The newly persisted erasure fence blocks
            // future reserve/commit under the shared owner lock. Existing
            // reserved rows remain visible, requiring a later verified
            // sweeper. verifyFenceAndRevocations() then reports FALSE.
          },
          async verifyFenceAndRevocations() {
            syntheticStage = 'verify outstanding reservations';
            const [fence, legacy, explicit, pending] = await Promise.all([
              tx.vcRecapErasureRequest.findUnique({
                where: { userId },
                select: { requestedAt: true, storageDeletionVerifiedAt: true },
              }),
              tx.userDataConsent.findUnique({
                where: { userId },
                select: {
                  voiceTranscriptionConsent: true,
                  voiceTranscriptRetentionConsentedAt: true,
                },
              }),
              tx.vcRecapExplicitConsent.findMany({
                where: { userId },
                select: { consentedAt: true, revokedAt: true },
              }),
              tx.vcRecapStorageObject.count({
                where: { userId, state: 'reserved' },
              }),
            ]);
            return {
              userId,
              requestedAt: fence?.requestedAt.toISOString() ?? '',
              storageDeletionVerifiedAt:
                fence?.storageDeletionVerifiedAt?.toISOString() ?? null,
              legacyConsentRevoked:
                legacy === null ||
                (!legacy.voiceTranscriptionConsent &&
                  legacy.voiceTranscriptRetentionConsentedAt === null),
              purposeConsentsRevoked: explicit.every(
                (entry) => entry.consentedAt === null && entry.revokedAt !== null,
              ),
              pendingWritesCancelled: pending === 0,
            };
          },
        };
        await callback(port);
      },
      { maxWait: 5000, timeout: 10000 },
    );
  } catch (error) {
    // A synthetic-CI-only class/code diagnostic; never reveal error messages,
    // query text, private user identifiers or connection strings.
    if (process.env['CI'] === 'true' && process.env['HERTA_VALORANT_TEST_DATABASE_URL']) {
      const kind = error instanceof Error ? error.name : 'UnknownError';
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'none';
      console.error('Synthetic restore PG failure category: ' + kind + '/' + code + ', stage=' + syntheticStage);
    }
    throw new Error('VC Recap restore PostgreSQL owner transaction unverified');
  }
}
