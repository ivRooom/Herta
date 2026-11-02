import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectVcRecapOwnerManifestSynthetic } from './vc-recap-erasure-owner-manifest.mjs';

const OWNER = '123456789012345678';
const OTHER_OWNER = '123456789012345679';
const BUCKET = 'approved-dedicated-vc-bucket';
const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const PREFIX = 'vc-recap/users/' + OWNER + '/';

const first = Object.freeze({
  id: UUID1,
  userId: OWNER,
  bucket: BUCKET,
  objectKey: PREFIX + 'session-a/audio.opus',
  kind: 'audio',
  state: 'committed',
  versionId: 'version-1',
});
const second = Object.freeze({
  id: UUID2,
  userId: OWNER,
  bucket: BUCKET,
  objectKey: PREFIX + 'session-b/transcript.json',
  kind: 'transcript',
  state: 'reserved',
  versionId: null,
});
const manifest = (objects = [first, second]) => ({
  schemaVersion: 1,
  ownerId: OWNER,
  bucket: BUCKET,
  objects,
});
const inspect = (value, bucket = BUCKET) => inspectVcRecapOwnerManifestSynthetic(value, bucket);
const rejected = (value, bucket = BUCKET) =>
  assert.throws(
    () => inspect(value, bucket),
    (error) =>
      error.message === 'VC Recap owner inventory unverified; keep erasure pending' &&
      !error.message.includes(OWNER) &&
      !error.message.includes(BUCKET) &&
      !error.message.includes('version-1'),
  );

test('exact two owner keys and reserved multipart intent are only locally scoped', () => {
  assert.deepEqual(inspect(manifest()), {
    status: 'owner-key-scope-validated-local-only',
    objectCount: 2,
    reservedCount: 1,
    canDeclareErased: false,
    canResumeTraffic: false,
  });
  assert.equal(Object.isFrozen(inspect(manifest())), true);
});

test('empty, malformed or oversized inventory never proves complete absence', () => {
  rejected(manifest([]));
  rejected({});
  rejected(null);
  rejected({ ...manifest(), schemaVersion: 3 });
  rejected({ ...manifest(), unseenStorage: true });
  rejected({ ...manifest(), ownerId: 'not-an-owner' });
  rejected({ ...manifest(), ownerId: OTHER_OWNER });
  rejected({ ...manifest(), bucket: 'other-bucket' });
  rejected(manifest(), 'other-bucket');
  rejected(manifest(), '');
  rejected(manifest(Array.from({ length: 10001 }, () => first)));
});

test('another owner, another bucket, or spoofed prefix never enters owner scope', () => {
  for (const changed of [
    { userId: OTHER_OWNER },
    { bucket: 'shared-production-backups' },
    { objectKey: 'vc-recap/users/' + OTHER_OWNER + '/session-a/audio.opus' },
    { objectKey: 'vc-recap/users/' + OWNER + '0/session-a/audio.opus' },
    { objectKey: 'vc-recap/users/' + OWNER },
    { objectKey: PREFIX },
    { objectKey: PREFIX + '../other-user/audio.opus' },
    { objectKey: PREFIX + 'folder/./audio.opus' },
    { objectKey: PREFIX + 'folder//audio.opus' },
    { objectKey: PREFIX + 'audio\nkey' },
    { objectKey: PREFIX + 'a'.repeat(1025) },
    { objectKey: 'vc-recap/other-owner/audio.opus' },
  ]) {
    rejected(manifest([{ ...first, ...changed }]));
  }
});

test('duplicate records/keys and invalid storage state or S3 version cannot pass', () => {
  rejected(manifest([first, first]));
  rejected(manifest([first, { ...second, objectKey: first.objectKey }]));
  rejected(manifest([first, { ...second, id: first.id }]));
  for (const changed of [
    { id: 'invalid-uuid' },
    { kind: 'summary' },
    { kind: 'archive' },
    { state: 'deleted' },
    { state: 'committed', versionId: null },
    { state: 'committed', versionId: 'null' },
    { state: 'committed', versionId: '' },
    { state: 'committed', versionId: 'bad\nversion' },
    { state: 'reserved', versionId: 'existing-version' },
    { unexpected: true },
  ]) {
    rejected(manifest([{ ...first, ...changed }]));
  }
});

test('future completeness or actual cleanup may never be implied by manifest success', () => {
  const result = inspect(manifest([first]));
  assert.equal(result.objectCount, 1);
  assert.equal(result.canDeclareErased, false);
  assert.equal(result.canResumeTraffic, false);
  assert.equal('complete' in result, false);
  assert.equal('keys' in result, false);
  // This module deliberately accepts no SDK, credentials or mutation adapter.
  assert.equal(inspectVcRecapOwnerManifestSynthetic.length, 2);
});
