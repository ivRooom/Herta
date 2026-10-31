import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@herta/db';
import type { S3VersionErasurePort } from './vc-recap-s3-erasure.js';
import { sweepPendingVcRecapErasureRequests } from './vc-recap-erasure-sweep.js';

const USER_ID = '123456789012345678';
const BUCKET = 'vc-recap-storage-example';

async function inEnabledEnvironment(run: () => Promise<void>) {
  const beforeSweep = process.env['VC_RECAP_ERASURE_SWEEP_ENABLED'];
  const beforeBucket = process.env['VC_RECAP_STORAGE_BUCKET'];
  process.env['VC_RECAP_ERASURE_SWEEP_ENABLED'] = 'true';
  process.env['VC_RECAP_STORAGE_BUCKET'] = BUCKET;
  try {
    await run();
  } finally {
    if (beforeSweep === undefined) delete process.env['VC_RECAP_ERASURE_SWEEP_ENABLED'];
    else process.env['VC_RECAP_ERASURE_SWEEP_ENABLED'] = beforeSweep;
    if (beforeBucket === undefined) delete process.env['VC_RECAP_STORAGE_BUCKET'];
    else process.env['VC_RECAP_STORAGE_BUCKET'] = beforeBucket;
  }
}

function fakeDatabase(state: 'committed' | 'reserved' | 'empty') {
  const calls: string[] = [];
  const prisma = {
    vcRecapErasureRequest: {
      findMany: async () => [{ userId: USER_ID }],
      update: async () => {
        calls.push('forbidden-final-completion');
        throw new Error('Must never claim total deletion');
      },
    },
    vcRecapStorageObject: {
      findMany: async () =>
        state === 'empty'
          ? []
          : [
              {
                id: 'object-1',
                bucket: BUCKET,
                objectKey: 'vc-recap/users/' + USER_ID + '/recording.opus',
                state,
                versionId: state === 'committed' ? 's3-version-1' : null,
              },
            ],
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

function fakePort(fail = false) {
  let deletes = 0;
  const port: S3VersionErasurePort = {
    async listMultipartUploads() {
      return { uploads: [], isTruncated: false };
    },
    async abortMultipartUpload() {
      throw new Error('No pending multipart upload');
    },
    async listObjectVersions() {
      return {
        versions:
          deletes === 0
            ? [
                {
                  key: 'vc-recap/users/' + USER_ID + '/recording.opus',
                  versionId: 's3-version-1',
                },
              ]
            : [],
        deleteMarkers: [],
        isTruncated: false,
      };
    },
    async deleteObjectVersions() {
      if (fail) throw new Error('Sensitive S3 object details must not be logged');
      deletes++;
      return { errors: [] };
    },
  };
  return { port, deletionCount: () => deletes };
}

test('Feature OFFなら削除対象の一覧を読み取る前に停止', async () => {
  await inEnabledEnvironment(async () => {
    delete process.env['VC_RECAP_ERASURE_SWEEP_ENABLED'];
    const db = fakeDatabase('committed');
    const storage = fakePort();
    await assert.rejects(
      sweepPendingVcRecapErasureRequests({
        prisma: db.prisma,
        port: storage.port,
        bucket: BUCKET,
      }),
      /disabled/,
    );
    assert.equal(storage.deletionCount(), 0);
  });
});

test('削除障壁のあるユーザーだけを掃除しても完了印は一切付けない', async () => {
  await inEnabledEnvironment(async () => {
    const db = fakeDatabase('committed');
    const storage = fakePort();
    const result = await sweepPendingVcRecapErasureRequests({
      prisma: db.prisma,
      port: storage.port,
      bucket: BUCKET,
    });
    assert.deepEqual(result, {
      attempted: 1,
      swept: 1,
      failed: 0,
      versionsDeleted: 1,
      deleteMarkersDeleted: 0,
      uploadsAborted: 0,
    });
    assert.deepEqual(db.calls, []);
    assert.equal(storage.deletionCount(), 1);
  });
});

test('アップロード予約が未完了ならS3削除を行わずブロックする', async () => {
  await inEnabledEnvironment(async () => {
    const db = fakeDatabase('reserved');
    const storage = fakePort();
    const failures: string[] = [];
    const report = await sweepPendingVcRecapErasureRequests({
      prisma: db.prisma,
      port: storage.port,
      bucket: BUCKET,
      onFailure: (name) => failures.push(name),
    });
    assert.equal(report.failed, 1);
    assert.equal(report.swept, 0);
    assert.equal(storage.deletionCount(), 0);
    assert.deepEqual(failures, ['Error']);
    assert.deepEqual(db.calls, []);
  });
});

test('S3障害で個人情報を含むエラーメッセージを外へ渡さない', async () => {
  await inEnabledEnvironment(async () => {
    const db = fakeDatabase('empty');
    const storage = fakePort(true);
    const failures: string[] = [];
    const result = await sweepPendingVcRecapErasureRequests({
      prisma: db.prisma,
      port: storage.port,
      bucket: BUCKET,
      onFailure: (name) => failures.push(name),
    });
    assert.equal(result.failed, 1);
    assert.deepEqual(failures, ['Error']);
    assert.equal(storage.deletionCount(), 0);
  });
});
