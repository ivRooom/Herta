import assert from 'node:assert/strict';
import test from 'node:test';
import {
  eraseVcRecapUserS3Prefix,
  vcRecapUserS3Prefix,
  type S3ErasureObject,
  type S3ErasureUpload,
  type S3VersionErasurePort,
} from './vc-recap-s3-erasure.js';

const USER = '123456789012345678';
const PREFIX = vcRecapUserS3Prefix(USER);
const BUCKET = 'private-vc-recap-test';

// prettier-ignore
function fakePort(options: {
  versions?: S3ErasureObject[];
  markers?: S3ErasureObject[];
  uploads?: S3ErasureUpload[];
  perObjectFailure?: boolean;
} = {}) {
  let versions = [...(options.versions ?? [])];
  let markers = [...(options.markers ?? [])];
  let uploads = [...(options.uploads ?? [])];
  const deleted: S3ErasureObject[] = [];
  const aborted: S3ErasureUpload[] = [];
  const prefixes: string[] = [];

  const port: S3VersionErasurePort = {
    async listObjectVersions({ prefix }) {
      prefixes.push(prefix);
      const combined = [...versions, ...markers].slice(0, 2);
      return {
        versions: combined.filter((entry) => versions.includes(entry)),
        deleteMarkers: combined.filter((entry) => markers.includes(entry)),
        isTruncated: versions.length + markers.length > combined.length,
      };
    },
    async deleteObjectVersions({ objects }) {
      if (options.perObjectFailure) {
        return { errors: [{ key: objects[0]!.key, versionId: objects[0]!.versionId }] };
      }
      deleted.push(...objects);
      versions = versions.filter((entry) => !objects.includes(entry));
      markers = markers.filter((entry) => !objects.includes(entry));
      return { errors: [] };
    },
    async listMultipartUploads({ prefix }) {
      prefixes.push(prefix);
      return { uploads: uploads.slice(0, 2), isTruncated: uploads.length > 2 };
    },
    async abortMultipartUpload({ key, uploadId }) {
      const match = uploads.find((upload) => upload.key === key && upload.uploadId === uploadId);
      if (match) aborted.push(match);
      uploads = uploads.filter((upload) => upload !== match);
    },
  };

  return {
    port,
    deleted,
    aborted,
    prefixes,
    pending: () => ({ versions, markers, uploads }),
  };
}

test('ユーザーごとの明確なprefixだけを許可する', () => {
  assert.equal(PREFIX, 'vc-recap/users/123456789012345678/');
  for (const invalid of ['', '../', '123/456', '123', 'admin', '0'.repeat(30)]) {
    assert.throws(() => vcRecapUserS3Prefix(invalid));
  }
});

test('大量のversionとdelete markerを各ページ先頭から再列挙して完全削除する', async () => {
  const objects = Array.from({ length: 7 }, (_, i) => ({
    key: `${PREFIX}audio/chunk-${i}`,
    versionId: `v${i}`,
  }));
  const marker = { key: `${PREFIX}audio/chunk-0`, versionId: 'delete-marker' };
  const upload = { key: `${PREFIX}audio/unfinished`, uploadId: 'multipart-1' };
  const mock = fakePort({ versions: objects, markers: [marker], uploads: [upload] });

  const report = await eraseVcRecapUserS3Prefix(mock.port, {
    bucket: BUCKET,
    userId: USER,
  });

  assert.deepEqual(report, {
    versionsDeleted: 7,
    deleteMarkersDeleted: 1,
    uploadsAborted: 1,
  });
  assert.deepEqual(mock.pending(), { versions: [], markers: [], uploads: [] });
  assert.ok(mock.prefixes.every((prefix) => prefix === PREFIX));
  assert.equal(mock.deleted.length, 8);
  assert.equal(mock.aborted.length, 1);
});

test('すでに削除されたユーザーの再実行は冪等で、別ユーザーのオブジェクトを触らない', async () => {
  const mock = fakePort();
  for (let i = 0; i < 2; i++) {
    const report = await eraseVcRecapUserS3Prefix(mock.port, {
      bucket: BUCKET,
      userId: USER,
    });
    assert.equal(report.versionsDeleted, 0);
    assert.equal(report.deleteMarkersDeleted, 0);
    assert.equal(report.uploadsAborted, 0);
  }
});

test('S3がprefix外のオブジェクトを返した場合は削除しない', async () => {
  const mock = fakePort({
    versions: [{ key: 'vc-recap/users/999999999999999999/audio.ogg', versionId: 'v1' }],
  });
  await assert.rejects(
    eraseVcRecapUserS3Prefix(mock.port, { bucket: BUCKET, userId: USER }),
    /escaped the user-owned prefix/,
  );
  assert.equal(mock.deleted.length, 0);
});

test('HTTP 200でもDeleteObjectsの部分エラーがあれば失敗として扱う', async () => {
  const mock = fakePort({
    versions: [{ key: `${PREFIX}audio.ogg`, versionId: 'v1' }],
    perObjectFailure: true,
  });
  await assert.rejects(
    eraseVcRecapUserS3Prefix(mock.port, { bucket: BUCKET, userId: USER }),
    /per-object deletion failures/,
  );
  assert.equal(mock.pending().versions.length, 1);
});

test('進捗しないページと上限超過を成功扱いせず、削除障壁を残す前提の失敗にする', async () => {
  const mock = fakePort({
    versions: Array.from({ length: 6 }, (_, i) => ({
      key: `${PREFIX}chunk-${i}`,
      versionId: `v${i}`,
    })),
  });
  await assert.rejects(
    eraseVcRecapUserS3Prefix(mock.port, { bucket: BUCKET, userId: USER, maxOperations: 2 }),
    /operation limit exceeded/,
  );
  assert.ok(mock.pending().versions.length > 0);

  const stuck: S3VersionErasurePort = {
    ...mock.port,
    async listObjectVersions() {
      return { versions: [], deleteMarkers: [], isTruncated: true };
    },
  };
  await assert.rejects(
    eraseVcRecapUserS3Prefix(stuck, { bucket: BUCKET, userId: USER }),
    /empty truncated page/,
  );
});

test('完了確認前に再出現したバージョンも二度目の確認で削除する', async () => {
  const mock = fakePort();
  let reads = 0;
  const port: S3VersionErasurePort = {
    ...mock.port,
    async listObjectVersions(input) {
      reads++;
      if (reads === 2) {
        return {
          versions: [{ key: `${PREFIX}late.ogg`, versionId: 'v-late' }],
          deleteMarkers: [],
          isTruncated: false,
        };
      }
      return mock.port.listObjectVersions(input);
    },
  };
  const report = await eraseVcRecapUserS3Prefix(port, { bucket: BUCKET, userId: USER });
  assert.equal(report.versionsDeleted, 1);
  assert.equal(mock.deleted.length, 1);
});
