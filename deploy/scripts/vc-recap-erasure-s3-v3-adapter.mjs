import { createHash, timingSafeEqual } from 'node:crypto';
import { validateErasureReceipt } from './vc-recap-erasure-ledger-contract.mjs';

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const MAX_RECEIPT_BYTES = 4096;

function assertConfiguredBucket() {
  const bucket = process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
  if (
    !bucket ||
    !BUCKET_NAME.test(bucket) ||
    bucket === process.env['VC_RECAP_STORAGE_BUCKET'] ||
    bucket === process.env['VC_RECAP_POSTGRES_BACKUP_BUCKET']
  ) {
    throw new Error('Independent VC erasure ledger bucket is not configured safely');
  }
  return bucket;
}

function validatedReceipt(input) {
  if (
    !input ||
    typeof input.key !== 'string' ||
    typeof input.body !== 'string' ||
    typeof input.sha256 !== 'string'
  ) {
    throw new Error('Invalid erasure receipt request');
  }
  const bytes = Buffer.from(input.body, 'utf8');
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES) {
    throw new Error('Invalid erasure receipt size');
  }
  let value;
  try {
    value = validateErasureReceipt(JSON.parse(input.body));
  } catch {
    throw new Error('Invalid erasure receipt content');
  }
  const canonical = JSON.stringify({
    kind: value.kind,
    requestId: value.requestId,
    userId: value.userId,
    requestedAt: value.requestedAt,
  });
  if (
    input.key !== 'erasure-ledger/v1/' + value.requestId + '.json' ||
    input.body !== canonical ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    createHash('sha256').update(bytes).digest('hex') !== input.sha256
  ) {
    throw new Error('Invalid erasure receipt identity');
  }
  return bytes;
}

function isExistingObjectConflict(error) {
  return (
    error &&
    typeof error === 'object' &&
    error.$metadata?.httpStatusCode === 412 &&
    error.name === 'PreconditionFailed'
  );
}

async function readVerifiedObject(client, commands, bucket, key, expected) {
  const response = await client.send(new commands.GetObjectCommand({ Bucket: bucket, Key: key }));
  if (
    !response ||
    response.$metadata?.httpStatusCode !== 200 ||
    !Number.isSafeInteger(response.ContentLength) ||
    response.ContentLength !== expected.length ||
    !response.Body ||
    typeof response.Body[Symbol.asyncIterator] !== 'function'
  ) {
    throw new Error('Erasure ledger readback is not verifiable');
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of response.Body) {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error('Erasure ledger returned invalid bytes');
    }
    length += chunk.length;
    if (length > MAX_RECEIPT_BYTES || length > expected.length) {
      throw new Error('Erasure ledger readback exceeded expected length');
    }
    chunks.push(chunk);
  }
  const actual = Buffer.concat(chunks);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Erasure ledger readback does not match submitted receipt');
  }
}

/**
 * AWS SDK v3-compatible adapter for a separately approved S3 ledger.
 * Client and command constructors are injected; no AWS SDK installation,
 * credentials, real S3 calls or production entrypoint wiring is performed here.
 *
 * IMPORTANT: A successful readback is not proof of an independently audited,
 * append-only bucket. IAM deny-delete, Object Lock/retention, inventory/DR
 * integrity and global VC read/write quarantine must be verified separately.
 */
export function createS3ErasureLedgerReceiptPort(client, commands) {
  if (
    !client ||
    typeof client.send !== 'function' ||
    !commands ||
    typeof commands.PutObjectCommand !== 'function' ||
    typeof commands.GetObjectCommand !== 'function'
  ) {
    throw new Error('S3 erasure ledger adapter is not configured');
  }

  return {
    async appendImmutableReceipt(input) {
      const bucket = assertConfiguredBucket();
      const expected = validatedReceipt(input);
      let existed = false;
      try {
        const put = await client.send(
          new commands.PutObjectCommand({
            Bucket: bucket,
            Key: input.key,
            Body: expected,
            ContentType: 'application/json',
            IfNoneMatch: '*',
            ChecksumSHA256: Buffer.from(input.sha256, 'hex').toString('base64'),
          }),
        );
        if (put?.$metadata?.httpStatusCode !== 200) {
          throw new Error('S3 receipt write was not acknowledged');
        }
      } catch (error) {
        if (!isExistingObjectConflict(error)) {
          // Never expose owner IDs, key names, bucket names or SDK error text.
          throw new Error('Independent erasure ledger write unavailable');
        }
        existed = true;
      }

      try {
        // A 412 alone is never idempotent success: compare the actual bytes.
        // A successful Put also needs readback to rule out false acks.
        await readVerifiedObject(client, commands, bucket, input.key, expected);
      } catch {
        throw new Error('Independent erasure ledger receipt could not be verified');
      }
      return { status: existed ? 'verified-existing' : 'durable', sha256: input.sha256 };
    },
  };
}
