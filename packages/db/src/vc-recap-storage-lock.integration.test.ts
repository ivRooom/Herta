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
      await prisma.$transaction(async (tx) => {
        await lockVcRecapStorageOwner(tx, owner);
        // A different owner must acquire its lock while the first is held.
        await prisma.$transaction(async (otherTx) => {
          await lockVcRecapStorageOwner(otherTx, other);
        }, { timeout: 5000, maxWait: 5000 });
        // The second same-owner request must reach PostgreSQL and time out
        // *before* the first transaction releases the advisory lock.
        await assert.rejects(
          prisma.$transaction(async (secondTx) => {
            await secondTx.$executeRawUnsafe("SET LOCAL lock_timeout = '150ms'");
            await lockVcRecapStorageOwner(secondTx, owner);
          }, { timeout: 5000, maxWait: 5000 }),
          /lock timeout|55P03|P2010/i,
        );
      }, { timeout: 10000, maxWait: 10000 });
      // Once the first owner lock is released, the same owner can acquire it.
      await prisma.$transaction(async (tx) => {
        await lockVcRecapStorageOwner(tx, owner);
      }, { timeout: 5000, maxWait: 5000 });
    } finally {
      await prisma.$disconnect();
    }
  },
);
