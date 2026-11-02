/**
 * #730: OFFLINE-ONLY validation of the prospective S3 owner ledger.
 * Not an S3 deletion worker, trusted completeness proof, or traffic permit.
 */
const OWNER = /^[0-9]{15,22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_OBJECTS = 10000;
const ERROR = 'VC Recap owner inventory unverified; keep erasure pending';

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}

/**
 * Input is untrusted restored-DB metadata. The caller-supplied expectedBucket
 * must eventually be pinned independently, never derived from the DB.
 * An empty list is NOT proof that the owner has no stored data.
 */
export function inspectVcRecapOwnerManifestSynthetic(manifest, expectedBucket) {
  try {
    if (
      !exactKeys(manifest, ['schemaVersion', 'ownerId', 'bucket', 'objects']) ||
      manifest.schemaVersion !== 1 ||
      typeof manifest.ownerId !== 'string' ||
      !OWNER.test(manifest.ownerId) ||
      typeof expectedBucket !== 'string' ||
      !BUCKET.test(expectedBucket) ||
      manifest.bucket !== expectedBucket ||
      !Array.isArray(manifest.objects) ||
      manifest.objects.length < 1 ||
      manifest.objects.length > MAX_OBJECTS
    ) {
      throw new Error(ERROR);
    }

    const prefix = 'vc-recap/users/' + manifest.ownerId + '/';
    const ids = new Set();
    const keys = new Set();
    let reservedCount = 0;
    for (const item of manifest.objects) {
      if (
        !exactKeys(item, ['id', 'userId', 'bucket', 'objectKey', 'kind', 'state', 'versionId']) ||
        typeof item.id !== 'string' ||
        !UUID.test(item.id) ||
        ids.has(item.id) ||
        item.userId !== manifest.ownerId ||
        item.bucket !== expectedBucket ||
        !['audio', 'transcript'].includes(item.kind) ||
        !['reserved', 'committed'].includes(item.state) ||
        typeof item.objectKey !== 'string' ||
        !item.objectKey.startsWith(prefix) ||
        item.objectKey.length <= prefix.length ||
        Buffer.byteLength(item.objectKey, 'utf8') > 1024 ||
        CONTROL.test(item.objectKey) ||
        item.objectKey.split('/').some((part) => part === '.' || part === '..' || part === '') ||
        keys.has(item.objectKey) ||
        (item.state === 'reserved' && item.versionId !== null) ||
        (item.state === 'committed' &&
          (typeof item.versionId !== 'string' ||
            item.versionId.length === 0 ||
            item.versionId === 'null' ||
            CONTROL.test(item.versionId) ||
            item.versionId.length > 1024))
      ) {
        throw new Error(ERROR);
      }
      ids.add(item.id);
      keys.add(item.objectKey);
      if (item.state === 'reserved') reservedCount++;
    }

    // This is a LOCAL scope check, never evidence of complete deletion.
    return Object.freeze({
      status: 'owner-key-scope-validated-local-only',
      objectCount: keys.size,
      reservedCount,
      canDeclareErased: false,
      canResumeTraffic: false,
    });
  } catch {
    // Never leak user IDs, S3 keys, bucket, version IDs or backend exceptions.
    throw new Error(ERROR);
  }
}
