/**
 * S3 object-version erasure primitive for future VC Recap user-owned storage.
 *
 * Not scheduled or connected to production: there is no dedicated VC audio
 * bucket or live writer yet; the new DB owner index is not connected. This cannot prove deletion
 * from DB snapshots, independently keyed archives, caches, or backup restores.
 * Never set VcRecapErasureRequest.storageDeletionVerifiedAt from this result.
 */
export interface S3ErasureObject {
  key: string;
  versionId: string;
}

export interface S3ErasureUpload {
  key: string;
  uploadId: string;
}

export interface S3ErasureListing {
  versions: S3ErasureObject[];
  deleteMarkers: S3ErasureObject[];
  isTruncated: boolean;
}

export interface S3ErasureUploadListing {
  uploads: S3ErasureUpload[];
  isTruncated: boolean;
}

// prettier-ignore
export interface S3VersionErasurePort {
  listObjectVersions(input: {
    bucket: string;
    prefix: string;
    maxKeys: number;
  }): Promise<S3ErasureListing>;
  deleteObjectVersions(input: {
    bucket: string;
    objects: S3ErasureObject[];
  }): Promise<{ errors: Array<{ key: string; versionId: string; code?: string }> }>;
  listMultipartUploads(input: {
    bucket: string;
    prefix: string;
    maxUploads: number;
  }): Promise<S3ErasureUploadListing>;
  abortMultipartUpload(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<void>;
}

export interface S3ErasureReport {
  versionsDeleted: number;
  deleteMarkersDeleted: number;
  uploadsAborted: number;
}

/** An explicit owner boundary: never delete from a bucket-wide or session-wide prefix. */
export function vcRecapUserS3Prefix(userId: string): string {
  if (!/^\d{15,22}$/.test(userId)) {
    throw new Error('Invalid Discord user ID for VC Recap S3 erasure');
  }
  return `vc-recap/users/${userId}/`;
}

function validateBucket(bucket: string): void {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('Invalid S3 bucket name');
  }
}

function assertOwnedKeys(prefix: string, entries: readonly { key: string }[]): void {
  if (entries.some((entry) => !entry.key.startsWith(prefix) || entry.key.length <= prefix.length)) {
    throw new Error('S3 erasure listing escaped the user-owned prefix');
  }
}

function requireCompletePage(size: number, truncated: boolean): void {
  if (truncated && size === 0) {
    // With no cursor progress, retrying would loop indefinitely.
    throw new Error('S3 erasure returned an empty truncated page');
  }
}

/**
 * Erase current/noncurrent versions, delete markers and pending multipart
 * uploads under ONE user-owned prefix. All lists start from the beginning:
 * deleting while following S3 key/version markers can skip objects.
 *
 * Re-check both listings before reporting a prefix sweep complete. The caller
 * MUST first establish a durable write-denial fence, stop ongoing recordings
 * and keep the fence active through restore/replay verification.
 *
 * Max-operations is a bounded safety valve, not a silent truncation: overflow
 * throws and the caller must retry later while keeping the fence active.
 */
export async function eraseVcRecapUserS3Prefix(
  port: S3VersionErasurePort,
  input: { bucket: string; userId: string; maxOperations?: number },
): Promise<S3ErasureReport> {
  validateBucket(input.bucket);
  const prefix = vcRecapUserS3Prefix(input.userId);
  const maxOperations = input.maxOperations ?? 10_000;
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 2) {
    throw new Error('Invalid S3 erasure operation limit');
  }

  const report: S3ErasureReport = {
    versionsDeleted: 0,
    deleteMarkersDeleted: 0,
    uploadsAborted: 0,
  };

  for (let operation = 0; operation < maxOperations; operation++) {
    // Abort in-progress multipart uploads before deleting completed objects.
    const multipart = await port.listMultipartUploads({
      bucket: input.bucket,
      prefix,
      maxUploads: 1000,
    });
    assertOwnedKeys(prefix, multipart.uploads);
    requireCompletePage(multipart.uploads.length, multipart.isTruncated);
    if (multipart.uploads.length > 0) {
      for (const upload of multipart.uploads) {
        if (!upload.uploadId) throw new Error('S3 multipart listing omitted upload ID');
        await port.abortMultipartUpload({
          bucket: input.bucket,
          key: upload.key,
          uploadId: upload.uploadId,
        });
        report.uploadsAborted++;
      }
      continue;
    }

    const listed = await port.listObjectVersions({
      bucket: input.bucket,
      prefix,
      maxKeys: 1000,
    });
    const objects = [...listed.versions, ...listed.deleteMarkers];
    assertOwnedKeys(prefix, objects);
    requireCompletePage(objects.length, listed.isTruncated);
    if (objects.length > 1000) {
      throw new Error('S3 erasure listing exceeded one delete batch');
    }
    if (objects.length > 0) {
      if (objects.some((object) => !object.versionId)) {
        throw new Error('S3 version listing omitted a version ID');
      }
      const outcome = await port.deleteObjectVersions({ bucket: input.bucket, objects });
      if (outcome.errors.length > 0) {
        // S3 DeleteObjects can return HTTP 200 with per-key failures.
        // Keep user identifiers and storage keys out of logs/errors.
        throw new Error('S3 erasure reported per-object deletion failures');
      }
      report.versionsDeleted += listed.versions.length;
      report.deleteMarkersDeleted += listed.deleteMarkers.length;
      continue;
    }

    // Two empty listing cycles are required: a final sweep after the first
    // empty result catches uploads completed during version enumeration.
    const uploadCheck = await port.listMultipartUploads({
      bucket: input.bucket,
      prefix,
      maxUploads: 1000,
    });
    assertOwnedKeys(prefix, uploadCheck.uploads);
    requireCompletePage(uploadCheck.uploads.length, uploadCheck.isTruncated);
    if (uploadCheck.uploads.length > 0) continue;

    const versionCheck = await port.listObjectVersions({
      bucket: input.bucket,
      prefix,
      maxKeys: 1000,
    });
    const rechecked = [...versionCheck.versions, ...versionCheck.deleteMarkers];
    assertOwnedKeys(prefix, rechecked);
    requireCompletePage(rechecked.length, versionCheck.isTruncated);
    if (rechecked.length > 0) continue;

    return report;
  }

  throw new Error('S3 erasure operation limit exceeded; deletion not verified');
}
