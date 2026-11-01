import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';

const databaseUrl = process.env['HERTA_VALORANT_TEST_DATABASE_URL'];

// prettier-ignore
test('real PostgreSQL: advisory lock returns a Prisma-supported value and serializes one owner',
  { skip: !databaseUrl },
  async () => {
    const url = new URL(databaseUrl!);
    assert(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.equal(url.pathname, '/valorant_test');
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const owner = '123456789012345680';
    const other = '123456789012345681';
    try {
      let acquiredSecond = false;
      let pending: Promise<void> | undefined;
      await prisma.$transaction(async (tx) => {
        await lockVcRecapStorageOwner(tx, owner);
        // Different owner must not block on the first owner's lock.
        await prisma.$transaction(async (otherTx) => {
          await lockVcRecapStorageOwner(otherTx, other);
        }, { timeout: 5000, maxWait: 5000 });
        pending = prisma.$transaction(async (secondTx) => {
          await lockVcRecapStorageOwner(secondTx, owner);
          acquiredSecond = true;
        }, { timeout: 10000, maxWait: 10000 });
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(acquiredSecond, false);
      }, { timeout: 10000, maxWait: 10000 });
      assert(pending);
      await pending;
      assert.equal(acquiredSecond, true);
    } finally {
      await prisma.$disconnect();
    }
  },
);
