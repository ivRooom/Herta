import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { appendLocalVcRecapSegmentIfConsented } from './vc-recap-guarded-segment.js';

function harness(granted: boolean, hasErasure = false, lockFailure = false, personal = true) {
  const calls: string[] = [];
  const tx = {
    $queryRawUnsafe: async (sql: string, owner: string) => {
      assert.match(sql, /pg_advisory_xact_lock/);
      assert.equal(owner, 'vc-recap-storage:123456789012345678');
      calls.push('lock');
      if (lockFailure) throw new Error('owner lock unavailable');
      return [];
    },
    userDataConsent: {
      findUnique: async () => {
        assert.deepEqual(calls, ['lock']);
        calls.push('consent');
        return {
          voiceTranscriptionConsent: granted,
          voiceTranscriptRetentionConsentedAt: personal ? new Date(0) : null,
        };
      },
    },
    vcRecapErasureRequest: {
      findUnique: async () => {
        assert.equal(calls[0], 'lock');
        calls.push('fence');
        return hasErasure ? { userId: '123456789012345678' } : null;
      },
    },
    vcRecapTranscriptSegment: {
      create: async () => {
        assert.equal(calls[0], 'lock');
        calls.push('write');
        return {};
      },
    },
  };
  return {
    calls,
    prisma: {
      $transaction: async (cb: (client: typeof tx) => Promise<boolean>) => cb(tx),
    } as unknown as PrismaClient,
  };
}

const item = {
  userId: '123456789012345678',
  sessionId: 'session-1',
  text: '合成テスト',
  startedAt: new Date(0),
  endedAt: new Date(1000),
};

test('local write takes owner lock before reading consent/fence and inserting segment', async () => {
  const { prisma, calls } = harness(true);
  assert.equal(await appendLocalVcRecapSegmentIfConsented(prisma, item), true);
  assert.equal(calls[0], 'lock');
  assert.equal(calls.at(-1), 'write');
});

test('erasure fence blocks local transcript insert even when old consent is true', async () => {
  const { prisma, calls } = harness(true, true);
  assert.equal(await appendLocalVcRecapSegmentIfConsented(prisma, item), false);
  assert.equal(calls.includes('write'), false);
});

test('refused or withdrawn personal consent blocks transcript insert', async () => {
  const { prisma, calls } = harness(false);
  assert.equal(await appendLocalVcRecapSegmentIfConsented(prisma, item), false);
  assert.equal(calls.includes('write'), false);
});

test('admin-granted legacy transcription without personal retention opt-in cannot write locally', async () => {
  const { prisma, calls } = harness(true, false, false, false);
  assert.equal(await appendLocalVcRecapSegmentIfConsented(prisma, item), false);
  assert.equal(calls.includes('write'), false);
});

test('database lock failure cannot be treated as a granted write', async () => {
  const { prisma, calls } = harness(true, false, true);
  await assert.rejects(appendLocalVcRecapSegmentIfConsented(prisma, item), /lock unavailable/);
  assert.deepEqual(calls, ['lock']);
});
