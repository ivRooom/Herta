import type {
  S3ErasureObject,
  S3VersionErasurePort,
} from './vc-recap-s3-erasure.js';

/**
 * AWS SDK v3-compatible S3 adapter. The actual client/command constructors
 * are injected, so no credentials, SDK dependency, or destructive service
 * initialization is added to the production worker at this stage.
 *
 * Future integration MUST instantiate the official @aws-sdk/client-s3
 * S3Client with the default AWS credential provider chain (IAM role), never
 * access-key environment variables committed to the repository.
 */
export interface S3V3CommandClient {
  send(command: unknown): Promise<unknown>;
}

export interface S3V3CommandConstructors {
  ListObjectVersionsCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectsCommand: new (input: Record<string, unknown>) => unknown;
  ListMultipartUploadsCommand: new (input: Record<string, unknown>) => unknown;
  AbortMultipartUploadCommand: new (input: Record<string, unknown>) => unknown;
}

interface S3ListVersionItem {
  Key?: string;
  VersionId?: string;
}

interface S3VersionListingResponse {
  Versions?: S3ListVersionItem[];
  DeleteMarkers?: S3ListVersionItem[];
  IsTruncated?: boolean;
}

interface S3DeleteObjectsResponse {
  Deleted?: S3ListVersionItem[];
  Errors?: Array<{ Key?: string; VersionId?: string; Code?: string }>;
}

interface S3MultipartListingResponse {
  Uploads?: Array<{ Key?: string; UploadId?: string }>;
  IsTruncated?: boolean;
}

function requireDedicatedBucket(bucket: string): void {
  const configured = process.env['VC_RECAP_STORAGE_BUCKET'];
  if (!configured || configured !== bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('Dedicated VC Recap S3 bucket is not configured');
  }
}

function requireOwnedPrefix(prefix: string): void {
  if (!/^vc-recap\/users\/\d{15,22}\/$/.test(prefix)) {
    throw new Error('S3 operation requires an explicit VC Recap user prefix');
  }
}

function requireOwnedKey(key: string): void {
  if (!/^vc-recap\/users\/\d{15,22}\/.+/.test(key)) {
    throw new Error('S3 operation requires a VC Recap user-owned key');
  }
}

function versions(items: S3ListVersionItem[] | undefined): S3ErasureObject[] {
  return (items ?? []).map((item) => {
    if (!item.Key || !item.VersionId || item.VersionId === 'null') {
      throw new Error('S3 returned a version without key or non-null version ID');
    }
    return { key: item.Key, versionId: item.VersionId };
  });
}

function requirePageSize(maximum: number): void {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000) {
    throw new Error('S3 page size must be between 1 and 1000');
  }
}

function checkedResponse<T>(raw: unknown): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('S3 SDK returned an invalid response');
  }
  return raw as T;
}

function sameVersion(a: S3ErasureObject, b: S3ErasureObject): boolean {
  return a.key === b.key && a.versionId === b.versionId;
}

/**
 * Converts AWS SDK v3 commands to the erasure core's port.
 * Does NOT run the sweeper or update completion flags. Enforces the configured
 * dedicated bucket and the user key boundary for every operation.
 */
export function createS3V3ErasurePort(
  client: S3V3CommandClient,
  commands: S3V3CommandConstructors,
): S3VersionErasurePort {
  return {
    async listObjectVersions({ bucket, prefix, maxKeys }) {
      requireDedicatedBucket(bucket);
      requireOwnedPrefix(prefix);
      requirePageSize(maxKeys);
      const response = checkedResponse<S3VersionListingResponse>(
        await client.send(
          new commands.ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: maxKeys,
          }),
        ),
      );
      return {
        versions: versions(response.Versions),
        deleteMarkers: versions(response.DeleteMarkers),
        isTruncated: response.IsTruncated === true,
      };
    },

    async deleteObjectVersions({ bucket, objects }) {
      requireDedicatedBucket(bucket);
      if (objects.length === 0 || objects.length > 1000) {
        throw new Error('S3 version deletion batch must contain 1 to 1000 objects');
      }
      for (const item of objects) {
        requireOwnedKey(item.key);
        if (!item.versionId || item.versionId === 'null') {
          throw new Error('S3 deletion requires a non-null version ID');
        }
      }
      const owners = new Set(objects.map((item) => item.key.split('/')[2]));
      if (owners.size !== 1) throw new Error('S3 deletion cannot cross user boundaries');

      const response = checkedResponse<S3DeleteObjectsResponse>(
        await client.send(
          new commands.DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: objects.map((item) => ({
                Key: item.key,
                VersionId: item.versionId,
              })),
              Quiet: false,
            },
          }),
        ),
      );

      const errors = (response.Errors ?? []).map((error) => ({
        key: error.Key ?? '',
        versionId: error.VersionId ?? '',
        code: error.Code,
      }));

      // Require a verbose result for each requested key/version. HTTP 200 can
      // contain per-object errors. Never mistake a missing acknowledgement
      // for successful erasure.
      const acknowledged = versions(response.Deleted);
      const missing = objects.filter(
        (requested) =>
          !acknowledged.some((deleted) => sameVersion(requested, deleted)) &&
          !errors.some((error) => sameVersion(requested, error)),
      );
      return {
        errors: [
          ...errors,
          ...missing.map((item) => ({ key: item.key, versionId: item.versionId })),
        ],
      };
    },

    async listMultipartUploads({ bucket, prefix, maxUploads }) {
      requireDedicatedBucket(bucket);
      requireOwnedPrefix(prefix);
      requirePageSize(maxUploads);
      const response = checkedResponse<S3MultipartListingResponse>(
        await client.send(
          new commands.ListMultipartUploadsCommand({
            Bucket: bucket,
            Prefix: prefix,
            MaxUploads: maxUploads,
          }),
        ),
      );
      const uploads = (response.Uploads ?? []).map((item) => {
        if (!item.Key || !item.UploadId) {
          throw new Error('S3 multipart upload listing omitted an upload ID or key');
        }
        return { key: item.Key, uploadId: item.UploadId };
      });
      return { uploads, isTruncated: response.IsTruncated === true };
    },

    async abortMultipartUpload({ bucket, key, uploadId }) {
      requireDedicatedBucket(bucket);
      requireOwnedKey(key);
      if (!uploadId) throw new Error('S3 multipart upload ID is required');
      checkedResponse(
        await client.send(
          new commands.AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          }),
        ),
      );
    },
  };
}
