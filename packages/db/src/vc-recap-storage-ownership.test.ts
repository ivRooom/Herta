import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  commitVcRecapStorageObject,
  listPendingVcRecapErasureUsers,
  listVcRecapUserStorageObjects,
  reserveVcRecapStorageObject,
  validateVcRecapStorageTarget,
} from './vc-recap-storage-ownership.js';
import { VC_RECAP_LONG_TERM_CONSENT_VERSION } from './vc-recap-explicit-consent.js';

const USER_ID = '123456789012345678';
const BUCKET = 'vc-recap-storage-example';
const KEY = 'vc-recap/users/' + USER_ID + '/audio/clip-1.opus';

function withStorageEnvironment<T>(run: () => Promise<T>): Promise<T> {
  const before = {
    bucket: process.env['VC_RECAP_STORAGE_BUCKET'],
    enabled: process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'],
    version: process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'],
  };
  process.env['VC_RECAP_STORAGE_BUCKET'] = BUCKET;
  process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'] = 'true';
  process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'] = VC_RECAP_LONG_TERM_CONSENT_VERSION;
  return run().finally(() => {
    for (const [key, value] of [
      ['VC_RECAP_STORAGE_BUCKET', before.bucket],
      ['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED', before.enabled],
      ['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION', before.version],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function setupFake(options: { fenced?: boolean; legacy?: boolean; consent?: boolean } = {}) {
  const operations: string[] = [];
  const tx = {
    $queryRawUnsafe: async (...args: unknown[]) => {
      operations.push('owner-lock');
      assert.equal(args[1], 'vc-recap-storage:' + USER_ID);
      return [{ pg_advisory_xact_lock: null }];
    },
    vcRecapErasureRequest: {
      findUnique: async () => (options.fenced ? { userId: USER_ID } : null),
    },
    userDataConsent: {
      findUnique: async () => ({ voiceTranscriptionConsent: options.legacy ?? true }),
    },
    vcRecapExplicitConsent: {
      findMany: async () =>
        options.consent === false
          ? []
          : [
              {
                purpose: 'audio_long_term',
                policyVersion: VC_RECAP_LONG_TERM_CONSENT_VERSION,
                consentedAt: new Date(),
                revokedAt: null,
              },
            ],
    },
    vcRecapStorageObject: {
      create: async () => {
        operations.push('reserve');
        return { id: 'owner-row-1' };
      },
      updateMany: async () => {
        operations.push('commit');
        return { count: 1 };
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaClient;
  return { prisma, operations };
}

test('別ユーザー・prefix外・誤ったbucketを登録しない', async () => {
  await withStorageEnvironment(async () => {
    validateVcRecapStorageTarget(USER_ID, BUCKET, KEY);
    assert.throws(() => validateVcRecapStorageTarget(USER_ID, 'general-backup', KEY));
    assert.throws(() =>
      validateVcRecapStorageTarget(USER_ID, BUCKET, 'vc-recap/users/999999999999999999/a'),
    );
    assert.throws(() => validateVcRecapStorageTarget('u1', BUCKET, KEY));
  });
});

test('公開ポリシーゲートOFFではDB予約が行われない', async () => {
  await withStorageEnvironment(async () => {
    const mock = setupFake();
    delete process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'];
    const result = await reserveVcRecapStorageObject(mock.prisma, {
      userId: USER_ID,
      sessionId: 'session-1',
      kind: 'audio',
      bucket: BUCKET,
      objectKey: KEY,
    });
    assert.deepEqual(result, { status: 'denied' });
    assert.deepEqual(mock.operations, []);
  });
});

test('本人同意・従来同意・削除障壁を確認してから予約する', async () => {
  await withStorageEnvironment(async () => {
    for (const input of [
      { fenced: true },
      { legacy: false },
      { consent: false },
    ]) {
      const mock = setupFake(input);
      assert.deepEqual(
        await reserveVcRecapStorageObject(mock.prisma, {
          userId: USER_ID,
          sessionId: 'session-1',
          kind: 'audio',
          bucket: BUCKET,
          objectKey: KEY,
        }),
        { status: 'denied' },
      );
      assert.deepEqual(mock.operations, ['owner-lock']);
    }
    const mock = setupFake();
    assert.deepEqual(
      await reserveVcRecapStorageObject(mock.prisma, {
        userId: USER_ID,
        sessionId: 'session-1',
        kind: 'audio',
        bucket: BUCKET,
        objectKey: KEY,
      }),
      { status: 'reserved', id: 'owner-row-1' },
    );
    assert.deepEqual(mock.operations, ['owner-lock', 'reserve']);
  });
});

test('本人が削除要求済みなら保存完了を拒否し、未完了登録を保持する', async () => {
  const blocked = setupFake({ fenced: true });
  assert.equal(
    await commitVcRecapStorageObject(blocked.prisma, {
      userId: USER_ID,
      id: 'owner-row-1',
      versionId: 's3-version-1',
    }),
    false,
  );
  assert.deepEqual(blocked.operations, ['owner-lock']);

  const allowed = setupFake();
  assert.equal(
    await commitVcRecapStorageObject(allowed.prisma, {
      userId: USER_ID,
      id: 'owner-row-1',
      versionId: 's3-version-1',
    }),
    true,
  );
  assert.deepEqual(allowed.operations, ['owner-lock', 'commit']);
});

test('所有者索引の別bucket・別prefixは読み出し時にも拒否', async () => {
  await withStorageEnvironment(async () => {
    const prisma = {
      vcRecapStorageObject: {
        findMany: async () => [
          { id: '1', bucket: 'general-backup', objectKey: KEY, state: 'committed' },
        ],
      },
    } as unknown as PrismaClient;
    await assert.rejects(listVcRecapUserStorageObjects(prisma, USER_ID), /dedicated/);
  });
});

test('未検証の削除依頼だけを上限付きで取得し、条件不正は拒否する', async () => {
  const prisma = {
    vcRecapErasureRequest: {
      findMany: async (args: unknown) => {
        assert.deepEqual(args, {
          where: { storageDeletionVerifiedAt: null },
          select: { userId: true },
          orderBy: [{ requestedAt: 'asc' }, { userId: 'asc' }],
          take: 20,
        });
        return [{ userId: USER_ID }];
      },
    },
  } as unknown as PrismaClient;
  assert.deepEqual(await listPendingVcRecapErasureUsers(prisma), [USER_ID]);
  await assert.rejects(listPendingVcRecapErasureUsers(prisma, 101), /Invalid/);
});
