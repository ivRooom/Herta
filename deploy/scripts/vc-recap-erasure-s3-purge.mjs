/**
 * Injected synthetic-only S3 single-key purge contract (#716 / #617).
 * NOT wired to production. This cannot prove all copies deleted or resume VC.
 * Production use requires a durable owner-write fence, IAM and human approval.
 */
const MAX_PAGES = 200;
const MAX_ITEMS = 10000;
const ERROR = 'VC Recap S3 purge proof unavailable; keep erasure pending';

function checkInput(client, commands, bucket, key) {
  if (
    !client ||
    typeof client.send !== 'function' ||
    !commands ||
    [
      'ListObjectVersionsCommand',
      'ListMultipartUploadsCommand',
      'DeleteObjectCommand',
      'AbortMultipartUploadCommand',
    ].some((name) => typeof commands[name] !== 'function') ||
    typeof bucket !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(bucket) ||
    typeof key !== 'string' ||
    !key.startsWith('vc-recap/') ||
    key.length <= 'vc-recap/'.length ||
    key.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(key) ||
    key.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error(ERROR);
  }
}

function entries(page, name) {
  if (page?.[name] === undefined) return [];
  if (!Array.isArray(page[name])) throw new Error(ERROR);
  return page[name];
}

function more(page, keyCursor, idCursor, seen) {
  if (page?.IsTruncated === undefined || page.IsTruncated === false) return null;
  if (page.IsTruncated !== true) throw new Error(ERROR);
  const key = page[keyCursor];
  const id = page[idCursor];
  if (typeof key !== 'string' || !key || typeof id !== 'string' || !id) {
    throw new Error(ERROR);
  }
  const token = JSON.stringify([key, id]);
  if (seen.has(token)) throw new Error(ERROR);
  seen.add(token);
  return [key, id];
}

async function inventoryVersions(client, commands, bucket, key) {
  const found = new Set();
  const seenCursors = new Set();
  let marker = null;
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const request = { Bucket: bucket, Prefix: key, MaxKeys: 1000 };
    if (marker) {
      request.KeyMarker = marker[0];
      request.VersionIdMarker = marker[1];
    }
    const page = await client.send(new commands.ListObjectVersionsCommand(request));
    if (!page || typeof page !== 'object') throw new Error(ERROR);
    for (const item of [...entries(page, 'Versions'), ...entries(page, 'DeleteMarkers')]) {
      if (
        !item ||
        typeof item.Key !== 'string' ||
        !item.Key.startsWith(key) ||
        typeof item.VersionId !== 'string' ||
        !item.VersionId ||
        item.VersionId === 'null'
      ) {
        throw new Error(ERROR);
      }
      if (item.Key !== key) continue;
      if (found.has(item.VersionId) || found.size >= MAX_ITEMS) throw new Error(ERROR);
      found.add(item.VersionId);
    }
    marker = more(page, 'NextKeyMarker', 'NextVersionIdMarker', seenCursors);
    if (!marker) return [...found];
  }
  throw new Error(ERROR);
}

async function inventoryUploads(client, commands, bucket, key) {
  const found = new Set();
  const seenCursors = new Set();
  let marker = null;
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const request = { Bucket: bucket, Prefix: key, MaxUploads: 1000 };
    if (marker) {
      request.KeyMarker = marker[0];
      request.UploadIdMarker = marker[1];
    }
    const page = await client.send(new commands.ListMultipartUploadsCommand(request));
    if (!page || typeof page !== 'object') throw new Error(ERROR);
    for (const item of entries(page, 'Uploads')) {
      if (
        !item ||
        typeof item.Key !== 'string' ||
        !item.Key.startsWith(key) ||
        typeof item.UploadId !== 'string' ||
        !item.UploadId
      ) {
        throw new Error(ERROR);
      }
      if (item.Key !== key) continue;
      if (found.has(item.UploadId) || found.size >= MAX_ITEMS) throw new Error(ERROR);
      found.add(item.UploadId);
    }
    marker = more(page, 'NextKeyMarker', 'NextUploadIdMarker', seenCursors);
    if (!marker) return [...found];
  }
  throw new Error(ERROR);
}

/**
 * Local readback of one exact key ONLY. It cannot prove other copies,
 * concurrent writes after the read, or safe traffic resumption.
 */
export async function purgeVcRecapS3KeySynthetic({ client, commands, bucket, key } = {}) {
  checkInput(client, commands, bucket, key);
  try {
    // Fully inventory both collections before any destructive operation.
    const versions = await inventoryVersions(client, commands, bucket, key);
    const uploads = await inventoryUploads(client, commands, bucket, key);
    for (const uploadId of uploads) {
      await client.send(
        new commands.AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
      );
    }
    for (const versionId of versions) {
      await client.send(
        new commands.DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }),
      );
    }
    const [remainingVersions, remainingUploads] = await Promise.all([
      inventoryVersions(client, commands, bucket, key),
      inventoryUploads(client, commands, bucket, key),
    ]);
    if (remainingVersions.length || remainingUploads.length) throw new Error(ERROR);
    return Object.freeze({
      status: 'single-key-local-list-empty-only',
      canDeclareErased: false,
      canResumeTraffic: false,
    });
  } catch {
    // Never expose identifiers, S3 keys, private metadata or SDK exceptions.
    throw new Error(ERROR);
  }
}
