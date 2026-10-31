import type { PrismaClient } from '@prisma/client';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';
import {
  VC_RECAP_LONG_TERM_CONSENT_VERSION,
  isVcRecapLongTermEnrollmentEnabled,
} from './vc-recap-explicit-consent.js';

export type VcRecapStoredObjectKind = 'audio' | 'transcript';

// prettier-ignore
export interface VcRecapStorageIntent {
  userId: string;
  sessionId: string;
  kind: VcRecapStoredObjectKind;
  bucket: string;
  objectKey: string;
}

export type VcRecapStorageReservation =
  | { status: 'reserved'; id: string }
  | { status: 'denied' };

/** Valid user-specific S3 prefix: shared session folders are not accepted. */
// prettier-ignore
export function vcRecapOwnedPrefix(userId: string): string {
  if (!/^\d{15,22}$/.test(userId)) throw new Error('Invalid VC Recap owner ID');
  return 'vc-recap/users/' + userId + '/';
}

/** Strictly match the dedicated VC bucket, never a general-purpose backup bucket. */
// prettier-ignore
export function validateVcRecapStorageTarget(
  userId: string,
  bucket: string,
  objectKey: string,
): void {
  const expectedBucket = process.env['VC_RECAP_STORAGE_BUCKET'];
  if (!expectedBucket || bucket !== expectedBucket) {
    throw new Error('Dedicated VC Recap storage bucket is not configured');
  }
  const prefix = vcRecapOwnedPrefix(userId);
  if (!objectKey.startsWith(prefix) || objectKey.length <= prefix.length) {
    throw new Error('Object key is not within the requesting owner prefix');
  }
}

/**
 * For future storage writers only. Must be invoked in a transaction before
 * writing any object; never silently import the existing 30-day consent.
 * This implementation remains unreachable from Bot and Worker main.
 *
 * The lock coordinates with requestVcRecapErasure; a future uploader must
 * recheck consent/fence while holding the same lock before a PUT and finish
 * or abort its pending intent before deletion is called complete.
 */
// prettier-ignore
export async function reserveVcRecapStorageObject(
  prisma: PrismaClient,
  input: VcRecapStorageIntent,
): Promise<VcRecapStorageReservation> {
  validateVcRecapStorageTarget(input.userId, input.bucket, input.objectKey);
  if (!input.sessionId || !['audio', 'transcript'].includes(input.kind)) {
    throw new Error('Invalid VC Recap storage intent');
  }
  if (!isVcRecapLongTermEnrollmentEnabled()) return { status: 'denied' };

  return prisma.$transaction(async (tx) => {
    await lockVcRecapStorageOwner(tx, input.userId);
    const [fence, legacy, consents] = await Promise.all([
      tx.vcRecapErasureRequest.findUnique({
        where: { userId: input.userId },
        select: { userId: true },
      }),
      tx.userDataConsent.findUnique({
        where: { userId: input.userId },
        select: { voiceTranscriptionConsent: true },
      }),
      tx.vcRecapExplicitConsent.findMany({
        where: {
          userId: input.userId,
          purpose: {
            in:
              input.kind === 'audio'
                ? ['audio_long_term']
                : ['transcription', 'transcript_long_term'],
          },
        },
        select: { purpose: true, policyVersion: true, consentedAt: true, revokedAt: true },
      }),
    ]);
    const granted = (purpose: string) =>
      consents.some(
        (record) =>
          record.purpose === purpose &&
          record.policyVersion === VC_RECAP_LONG_TERM_CONSENT_VERSION &&
          record.consentedAt !== null &&
          record.revokedAt === null,
      );
    if (
      fence !== null ||
      !legacy?.voiceTranscriptionConsent ||
      (input.kind === 'audio'
        ? !granted('audio_long_term')
        : !granted('transcription') || !granted('transcript_long_term'))
    ) {
      return { status: 'denied' } as const;
    }

    const record = await tx.vcRecapStorageObject.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId,
        kind: input.kind,
        bucket: input.bucket,
        objectKey: input.objectKey,
        state: 'reserved',
      },
      select: { id: true },
    });
    return { status: 'reserved', id: record.id } as const;
  });
}

/**
 * Complete only a previously reserved upload; if a user requested erasure,
 * retain the reservation for the sweeper and return false. The caller must
 * stop serving this object and arrange deletion, not retry upload blindly.
 */
// prettier-ignore
export async function commitVcRecapStorageObject(
  prisma: PrismaClient,
  input: { userId: string; id: string; versionId: string },
): Promise<boolean> {
  vcRecapOwnedPrefix(input.userId);
  if (!input.id || !input.versionId || input.versionId === 'null') {
    throw new Error('S3 version ID is required for committed storage');
  }
  return prisma.$transaction(async (tx) => {
    await lockVcRecapStorageOwner(tx, input.userId);
    const fence = await tx.vcRecapErasureRequest.findUnique({
      where: { userId: input.userId },
      select: { userId: true },
    });
    if (fence !== null) return false;

    const updated = await tx.vcRecapStorageObject.updateMany({
      where: { id: input.id, userId: input.userId, state: 'reserved' },
      data: { state: 'committed', versionId: input.versionId, committedAt: new Date() },
    });
    return updated.count === 1;
  });
}

/** Read-only immutable ownership inventory for the eventual erasure worker. */
// prettier-ignore
export async function listVcRecapUserStorageObjects(
  prisma: PrismaClient,
  userId: string,
): Promise<Array<{
  id: string;
  bucket: string;
  objectKey: string;
  state: string;
  versionId: string | null;
}>> {
  vcRecapOwnedPrefix(userId);
  const objects = await prisma.vcRecapStorageObject.findMany({
    where: { userId },
    select: { id: true, bucket: true, objectKey: true, state: true, versionId: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const object of objects) {
    validateVcRecapStorageTarget(userId, object.bucket, object.objectKey);
  }
  return objects;
}

/** An empty result is not proof of absence of previously unindexed objects. */
// prettier-ignore
export async function listPendingVcRecapErasureUsers(
  prisma: PrismaClient,
  limit = 20,
): Promise<string[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid VC Recap erasure scan limit');
  }
  const rows = await prisma.vcRecapErasureRequest.findMany({
    where: { storageDeletionVerifiedAt: null },
    select: { userId: true },
    orderBy: [{ requestedAt: 'asc' }, { userId: 'asc' }],
    take: limit,
  });
  return rows.map((row) => row.userId);
}
