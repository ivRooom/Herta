import { createHash } from 'node:crypto';
import {
  assembleErasureSnapshot,
  validateErasureReceipt,
} from './vc-recap-erasure-ledger-contract.mjs';

const PREFIX = 'erasure-ledger/v1/';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_RECEIPT_BYTES = 4096;

function bucketForAudit() {
  const bucket = process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
  if (
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket === process.env['VC_RECAP_STORAGE_BUCKET'] ||
    bucket === process.env['VC_RECAP_POSTGRES_BACKUP_BUCKET']
  ) {
    throw new Error('Independent erasure ledger bucket is not safely configured');
  }
  return bucket;
}

function assertVersion(entry) {
  if (
    !entry ||
    typeof entry !== 'object' ||
    typeof entry.Key !== 'string' ||
    !entry.Key.startsWith(PREFIX) ||
    !UUID_V4.test(entry.Key.slice(PREFIX.length, -5)) ||
    !entry.Key.endsWith('.json') ||
    typeof entry.VersionId !== 'string' ||
    entry.VersionId === 'null' ||
    entry.VersionId.length === 0 ||
    entry.VersionId.length > 1024 ||
    entry.IsLatest !== true ||
    !Number.isSafeInteger(entry.Size) ||
    entry.Size < 1 ||
    entry.Size > MAX_RECEIPT_BYTES
  ) {
    throw new Error('Independent erasure ledger version inventory is invalid');
  }
}

async function readReceiptVersion(client, commands, bucket, entry) {
  const response = await client.send(
    new commands.GetObjectCommand({
      Bucket: bucket,
      Key: entry.Key,
      VersionId: entry.VersionId,
    }),
  );
  if (
    !response ||
    response.$metadata?.httpStatusCode !== 200 ||
    response.VersionId !== entry.VersionId ||
    response.ContentLength !== entry.Size ||
    !response.Body ||
    typeof response.Body[Symbol.asyncIterator] !== 'function'
  ) {
    throw new Error('Independent erasure ledger version readback is incomplete');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.Body) {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error('Independent erasure ledger version returned invalid bytes');
    }
    size += chunk.length;
    if (size > MAX_RECEIPT_BYTES || size > entry.Size) {
      throw new Error('Independent erasure ledger version exceeded declared size');
    }
    chunks.push(chunk);
  }
  if (size !== entry.Size) {
    throw new Error('Independent erasure ledger version readback is incomplete');
  }
  const bytes = Buffer.concat(chunks);
  let receipt;
  try {
    receipt = validateErasureReceipt(JSON.parse(bytes.toString('utf8')));
  } catch {
    throw new Error('Independent erasure ledger receipt is invalid');
  }
  const canonical = JSON.stringify({
    kind: receipt.kind,
    requestId: receipt.requestId,
    userId: receipt.userId,
    requestedAt: receipt.requestedAt,
  });
  if (
    entry.Key !== PREFIX + receipt.requestId + '.json' ||
    !bytes.equals(Buffer.from(canonical, 'utf8'))
  ) {
    throw new Error('Independent erasure ledger receipt key or bytes mismatch');
  }
  return {
    receipt,
    receiptSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Performs local reconciliation of EVERY listed S3 version against separately
 * supplied inventory evidence. It does NOT authenticate the evidence, its
 * provenance, or whether concurrent writes/compromised administrators altered
 * the bucket. Callers must prove those independently and enforce quarantine.
 *
 * No caller in production is wired to this module; no AWS credentials are
 * initialized. The return type NEVER allows VC traffic to resume.
 */
export async function inspectVcRecapErasureLedgerVersions(client, commands, options) {
  if (
    !client ||
    typeof client.send !== 'function' ||
    !commands ||
    typeof commands.ListObjectVersionsCommand !== 'function' ||
    typeof commands.GetObjectCommand !== 'function' ||
    !options ||
    !Number.isSafeInteger(options.expectedCount) ||
    options.expectedCount < 0 ||
    options.expectedCount > 100000 ||
    !SHA256.test(options.expectedManifestSha256) ||
    (options.expectedCount === 0 && options.allowEmpty !== true) ||
    !Number.isSafeInteger(options.maxPages ?? 200) ||
    (options.maxPages ?? 200) < 1 ||
    (options.maxPages ?? 200) > 1000
  ) {
    throw new Error('Independent erasure ledger audit prerequisites missing');
  }

  const bucket = bucketForAudit();
  const versions = [];
  const seenKeys = new Set();
  const seenMarkers = new Set();
  let keyMarker;
  let versionIdMarker;
  let complete = false;
  try {
    for (let pageIndex = 0; pageIndex < (options.maxPages ?? 200); pageIndex++) {
      const input = { Bucket: bucket, Prefix: PREFIX, MaxKeys: 1000 };
      if (keyMarker !== undefined) {
        input.KeyMarker = keyMarker;
        if (versionIdMarker !== undefined) input.VersionIdMarker = versionIdMarker;
      }
      const page = await client.send(new commands.ListObjectVersionsCommand(input));
      if (
        !page ||
        ![true, false].includes(page.IsTruncated) ||
        (page.Versions !== undefined && !Array.isArray(page.Versions)) ||
        (page.DeleteMarkers !== undefined && !Array.isArray(page.DeleteMarkers)) ||
        (page.CommonPrefixes !== undefined && page.CommonPrefixes.length > 0)
      ) {
        throw new Error('Independent erasure ledger listing is malformed');
      }

      if ((page.DeleteMarkers ?? []).length !== 0) {
        throw new Error('Independent erasure ledger contains a delete marker');
      }
      const items = page.Versions ?? [];
      if (items.length === 0 && page.IsTruncated) {
        throw new Error('Independent erasure ledger listing did not advance');
      }
      for (const item of items) {
        assertVersion(item);
        if (seenKeys.has(item.Key)) {
          // Multiple versions are not an immutable one-request-one-object log.
          throw new Error('Independent erasure ledger has duplicate object versions');
        }
        seenKeys.add(item.Key);
        versions.push(item);
        if (versions.length > options.expectedCount) {
          throw new Error('Independent erasure ledger exceeds expected inventory');
        }
      }

      if (!page.IsTruncated) {
        complete = true;
        break;
      }
      if (
        typeof page.NextKeyMarker !== 'string' ||
        page.NextKeyMarker.length === 0 ||
        (page.NextVersionIdMarker !== undefined &&
          typeof page.NextVersionIdMarker !== 'string')
      ) {
        throw new Error('Independent erasure ledger page cursor is absent');
      }
      const marker = JSON.stringify([
        page.NextKeyMarker,
        page.NextVersionIdMarker ?? null,
      ]);
      if (seenMarkers.has(marker)) {
        throw new Error('Independent erasure ledger pagination cursor repeated');
      }
      seenMarkers.add(marker);
      keyMarker = page.NextKeyMarker;
      versionIdMarker = page.NextVersionIdMarker;
    }

    if (!complete || versions.length !== options.expectedCount) {
      throw new Error('Independent erasure ledger inventory is incomplete');
    }
    const manifest = [];
    const receipts = [];
    for (const item of versions) {
      const { receipt, receiptSha256 } = await readReceiptVersion(
        client,
        commands,
        bucket,
        item,
      );
      receipts.push(receipt);
      manifest.push({ key: item.Key, versionId: item.VersionId, receiptSha256 });
    }
    manifest.sort((a, b) => a.key.localeCompare(b.key, 'en'));
    const actualSha256 = createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex');
    if (actualSha256 !== options.expectedManifestSha256) {
      throw new Error('Independent erasure ledger inventory checksum mismatch');
    }

    const snapshot = assembleErasureSnapshot(receipts, {
      generatedAt: options.generatedAt,
      independentlyAuditedCount: options.expectedCount,
    });
    return {
      status: 'local-reconciliation-only',
      canResumeTraffic: false,
      objectCount: versions.length,
      manifestSha256: actualSha256,
      snapshot,
    };
  } catch {
    // AWS/JSON exception details may contain personal IDs or object keys.
    throw new Error('Independent erasure ledger could not be locally reconciled');
  }
}
