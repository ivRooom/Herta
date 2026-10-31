import {
  listPendingVcRecapErasureUsers,
  listVcRecapUserStorageObjects,
  type PrismaClient,
} from '@herta/db';
import {
  eraseVcRecapUserS3Prefix,
  type S3ErasureReport,
  type S3VersionErasurePort,
} from './vc-recap-s3-erasure.js';

export interface VcRecapErasureSweepReport {
  attempted: number;
  swept: number;
  failed: number;
  versionsDeleted: number;
  deleteMarkersDeleted: number;
  uploadsAborted: number;
}

export interface VcRecapErasureSweepOptions {
  prisma: PrismaClient;
  port: S3VersionErasurePort;
  bucket: string;
  maxUsers?: number;
  onFailure?: (errorName: string) => void;
}

/**
 * Disabled unless deliberately invoked with the exact dedicated bucket and
 * explicit feature switch. NOT registered with Worker main or any timer.
 *
 * Important: a successful S3 prefix sweep is NOT proof of complete erasure.
 * The DB fence remains in place. Never mark storageDeletionVerifiedAt here:
 * all archive formats, caches, snapshots, restore copies and replica locations
 * must be audited by a separate recovery/verification process.
 */
export async function sweepPendingVcRecapErasureRequests(
  options: VcRecapErasureSweepOptions,
): Promise<VcRecapErasureSweepReport> {
  if (
    process.env['VC_RECAP_ERASURE_SWEEP_ENABLED'] !== 'true' ||
    !process.env['VC_RECAP_STORAGE_BUCKET'] ||
    options.bucket !== process.env['VC_RECAP_STORAGE_BUCKET']
  ) {
    throw new Error('VC Recap S3 erasure sweep is disabled');
  }

  const users = await listPendingVcRecapErasureUsers(options.prisma, options.maxUsers ?? 20);
  const report: VcRecapErasureSweepReport = {
    attempted: 0,
    swept: 0,
    failed: 0,
    versionsDeleted: 0,
    deleteMarkersDeleted: 0,
    uploadsAborted: 0,
  };

  for (const userId of users) {
    report.attempted++;
    try {
      const inventory = await listVcRecapUserStorageObjects(options.prisma, userId);
      // A reserved upload may still complete after a delete sweep. Do not
      // report a successful sweep until uploads are reconciled and quiescent.
      if (inventory.some((object) => object.state !== 'committed')) {
        throw new Error('VC Recap storage upload intents are still pending');
      }

      const deleted: S3ErasureReport = await eraseVcRecapUserS3Prefix(options.port, {
        bucket: options.bucket,
        userId,
      });
      report.swept++;
      report.versionsDeleted += deleted.versionsDeleted;
      report.deleteMarkersDeleted += deleted.deleteMarkersDeleted;
      report.uploadsAborted += deleted.uploadsAborted;
    } catch (error) {
      report.failed++;
      // Never include raw user IDs, S3 keys or original exception messages.
      options.onFailure?.(error instanceof Error ? error.name : 'UnknownError');
    }
  }
  return report;
}
