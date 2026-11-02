import assert from 'node:assert/strict';
import test from 'node:test';
import { purgeVcRecapS3KeySynthetic } from './vc-recap-erasure-s3-purge.mjs';

const BUCKET = 'synthetic-vc-bucket';
const KEY = 'vc-recap/synthetic-owner/audio.opus';
const NEIGHBOR = KEY + '.other';

const commands = Object.fromEntries(
  ['ListObjectVersions', 'ListMultipartUploads', 'DeleteObject', 'AbortMultipartUpload'].map(
    (name) => [
      name + 'Command',
      class {
        constructor(input) {
          this.name = name;
          this.input = input;
        }
      },
    ],
  ),
);

function mock({ versions = [], uploads = [], size = 1000, failOn, race = false, badPage } = {}) {
  const items = versions.map((item) => ({ ...item }));
  const activeUploads = uploads.map((item) => ({ ...item }));
  const calls = [];
  let raced = false;
  const client = {
    async send(command) {
      calls.push(command);
      if (failOn?.(command, calls)) throw new Error('secret-private-identifier');
      const { name, input } = command;
      assert.equal(input.Bucket, BUCKET);
      if (name === 'ListObjectVersions' || name === 'ListMultipartUploads') {
        const injected = badPage?.(name);
        if (injected) return injected;
        const multipart = name === 'ListMultipartUploads';
        const all = (multipart ? activeUploads : items).filter((item) =>
          item.Key.startsWith(input.Prefix),
        );
        const cursor = multipart ? input.UploadIdMarker : input.VersionIdMarker;
        const start = cursor
          ? all.findIndex((item) => (multipart ? item.UploadId : item.VersionId) === cursor) + 1
          : 0;
        if (cursor && !start) throw new Error('unknown synthetic cursor');
        const page = all.slice(start, start + size);
        const result = { IsTruncated: start + size < all.length };
        if (multipart) {
          result.Uploads = page;
        } else {
          result.Versions = page.filter((item) => !item.deleteMarker);
          result.DeleteMarkers = page.filter((item) => item.deleteMarker);
        }
        if (result.IsTruncated) {
          result.NextKeyMarker = page.at(-1).Key;
          result[multipart ? 'NextUploadIdMarker' : 'NextVersionIdMarker'] = multipart
            ? page.at(-1).UploadId
            : page.at(-1).VersionId;
        }
        return result;
      }
      assert.equal(input.Key, KEY, 'must never delete a neighboring key');
      if (name === 'AbortMultipartUpload') {
        const index = activeUploads.findIndex(
          (item) => item.Key === KEY && item.UploadId === input.UploadId,
        );
        if (index >= 0) activeUploads.splice(index, 1);
        return {};
      }
      if (name === 'DeleteObject') {
        assert.notEqual(input.VersionId, undefined);
        const index = items.findIndex(
          (item) => item.Key === KEY && item.VersionId === input.VersionId,
        );
        if (index >= 0) items.splice(index, 1);
        if (race && !raced) {
          raced = true;
          items.push({ Key: KEY, VersionId: 'concurrent-write' });
        }
        return {};
      }
      throw new Error('unexpected mock operation');
    },
  };
  return { client, calls, items, activeUploads };
}

const run = (client, options = {}) =>
  purgeVcRecapS3KeySynthetic({ client, commands, bucket: BUCKET, key: KEY, ...options });

const SAFE_RESULT = {
  status: 'single-key-local-list-empty-only',
  canDeclareErased: false,
  canResumeTraffic: false,
};

test('all versions, delete markers and multipart across pages; neighbor untouched', async () => {
  const fixture = mock({
    size: 1,
    versions: [
      { Key: KEY, VersionId: 'v1' },
      { Key: KEY, VersionId: 'v2', deleteMarker: true },
      { Key: NEIGHBOR, VersionId: 'neighbor-version' },
    ],
    uploads: [
      { Key: KEY, UploadId: 'u1' },
      { Key: KEY, UploadId: 'u2' },
      { Key: NEIGHBOR, UploadId: 'neighbor-upload' },
    ],
  });
  assert.deepEqual(await run(fixture.client), SAFE_RESULT);
  assert.deepEqual(
    fixture.items.map((x) => x.Key),
    [NEIGHBOR],
  );
  assert.deepEqual(
    fixture.activeUploads.map((x) => x.Key),
    [NEIGHBOR],
  );
  assert.equal(
    fixture.calls.filter((x) => ['DeleteObject', 'AbortMultipartUpload'].includes(x.name)).length,
    4,
  );
});

test('retry after a successful purge does not perform further deletions', async () => {
  const fixture = mock({ versions: [{ Key: KEY, VersionId: 'v1' }] });
  assert.deepEqual(await run(fixture.client), SAFE_RESULT);
  const initial = fixture.calls.length;
  assert.deepEqual(await run(fixture.client), SAFE_RESULT);
  assert.equal(
    fixture.calls.slice(initial).some((x) => x.name === 'DeleteObject'),
    false,
  );
});

test('invalid scope and adapters fail before S3 access', async () => {
  const fixture = mock();
  for (const options of [
    { key: '' },
    { key: 'erasure-ledger/v1/key.json' },
    { key: 'vc-recap/' },
    { key: 'vc-recap/../other' },
    { key: 'vc-recap/bad\nkey' },
    { bucket: 'not a bucket' },
    { client: {} },
    { commands: {} },
  ]) {
    await assert.rejects(run(fixture.client, options), /keep erasure pending/);
  }
  assert.equal(fixture.calls.length, 0);
});

test('invalid, duplicate or null VersionIds fail before deletion', async () => {
  for (const versions of [
    [{ Key: KEY, VersionId: 'null' }],
    [
      { Key: KEY, VersionId: 'v1' },
      { Key: KEY, VersionId: 'v1', deleteMarker: true },
    ],
  ]) {
    const fixture = mock({ versions });
    await assert.rejects(run(fixture.client), /keep erasure pending/);
    assert.equal(
      fixture.calls.some((x) => x.name === 'DeleteObject'),
      false,
    );
  }
});

test('unexpected prefix, missing pagination marker, repeated marker are rejected', async () => {
  const pages = [
    { Versions: [{ Key: 'outside-key', VersionId: 'v1' }] },
    { IsTruncated: true, Versions: [{ Key: KEY, VersionId: 'v1' }] },
    {
      IsTruncated: true,
      NextKeyMarker: KEY,
      NextVersionIdMarker: 'v1',
      Versions: [{ Key: KEY, VersionId: 'v1' }],
    },
  ];
  for (const page of pages) {
    const fixture = mock({
      badPage: (name) => name === 'ListObjectVersions' && page,
    });
    await assert.rejects(run(fixture.client), /keep erasure pending/);
    assert.equal(
      fixture.calls.some((x) => x.name === 'DeleteObject'),
      false,
    );
  }
});

test('unverified or duplicate multipart pagination blocks all mutations', async () => {
  for (const options of [
    { badPage: (name) => name === 'ListMultipartUploads' && { IsTruncated: true } },
    {
      uploads: [
        { Key: KEY, UploadId: 'u1' },
        { Key: KEY, UploadId: 'u1' },
      ],
    },
  ]) {
    const fixture = mock({ versions: [{ Key: KEY, VersionId: 'v1' }], ...options });
    await assert.rejects(run(fixture.client), /keep erasure pending/);
    assert.equal(
      fixture.calls.some((x) => x.name === 'DeleteObject'),
      false,
    );
  }
});

test('SDK partial failure redacts private values and can be retried', async () => {
  let failed = false;
  const fixture = mock({
    versions: [
      { Key: KEY, VersionId: 'v1' },
      { Key: KEY, VersionId: 'v2' },
    ],
    failOn: (command) => {
      if (!failed && command.name === 'DeleteObject') {
        failed = true;
        return true;
      }
      return false;
    },
  });
  await assert.rejects(
    run(fixture.client),
    (error) =>
      error.message.includes('keep erasure pending') && !error.message.includes('secret-private'),
  );
  assert.deepEqual(await run(fixture.client), SAFE_RESULT);
});

test('concurrent write during deletion fails closed even after old versions vanish', async () => {
  const fixture = mock({ versions: [{ Key: KEY, VersionId: 'v1' }], race: true });
  await assert.rejects(run(fixture.client), /keep erasure pending/);
  assert.deepEqual(
    fixture.items.map((x) => x.VersionId),
    ['concurrent-write'],
  );
});

test('post-deletion verification failure is never treated as erasure success', async () => {
  let reads = 0;
  const fixture = mock({
    versions: [{ Key: KEY, VersionId: 'v1' }],
    failOn: (command) => command.name === 'ListObjectVersions' && ++reads > 1,
  });
  await assert.rejects(run(fixture.client), /keep erasure pending/);
});
