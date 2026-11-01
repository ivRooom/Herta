import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  appendVcRecapLocalWhisperSegmentIfConsented,
  appendVcRecapTranscriptSegment,
} from './vc-recap.js';

const USER_ID = '123456789012345678';
const SEGMENT = {
  sessionId: 'session-1',
  userId: USER_ID,
  text: '合成テストの本文',
  startedAt: new Date('2026-10-01T00:00:00Z'),
  endedAt: new Date('2026-10-01T00:00:02Z'),
};

function fakePrisma(
  options: {
    affirmative?: boolean;
    personalRetention?: boolean;
    erasure?: boolean;
    onLock?: () => void;
    failConsentRead?: boolean;
  } = {},
) {
  const steps: string[] = [];
  let inserts = 0;
  const tx = {
    $queryRawUnsafe: async (_sql: string, owner: string) => {
      assert.equal(owner, 'vc-recap-storage:' + USER_ID);
      steps.push('lock');
      options.onLock?.();
      return [];
    },
    userDataConsent: {
      findUnique: async () => {
        steps.push('consent');
        if (options.failConsentRead) throw new Error('database unavailable');
        return {
          voiceTranscriptionConsent: options.affirmative ?? true,
          voiceTranscriptRetentionConsentedAt:
            (options.personalRetention ?? true) ? new Date('2026-10-01T00:00:00Z') : null,
        };
      },
    },
    vcRecapErasureRequest: {
      findUnique: async () => {
        steps.push('erasure');
        return options.erasure ? { userId: USER_ID } : null;
      },
    },
    vcRecapTranscriptSegment: {
      create: async ({ data }: { data: typeof SEGMENT }) => {
        steps.push('insert');
        assert.deepEqual(data, SEGMENT);
        inserts += 1;
      },
    },
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    vcRecapTranscriptSegment: {
      create: tx.vcRecapTranscriptSegment.create,
    },
  } as unknown as PrismaClient;
  return { prisma, steps, getInserts: () => inserts };
}

test('local Whisper commits only personally consented, non-erased segments under an owner lock', async () => {
  const fake = fakePrisma();
  assert.equal(await appendVcRecapLocalWhisperSegmentIfConsented(fake.prisma, SEGMENT), true);
  assert.deepEqual(fake.steps, ['lock', 'consent', 'erasure', 'insert']);
  assert.equal(fake.getInserts(), 1);
});

test('local Whisper denies an admin grant lacking personal 30-day retention consent', async () => {
  const fake = fakePrisma({ personalRetention: false });
  assert.equal(await appendVcRecapLocalWhisperSegmentIfConsented(fake.prisma, SEGMENT), false);
  assert.deepEqual(fake.steps, ['lock', 'consent']);
  assert.equal(fake.getInserts(), 0);
});

test('local Whisper refuses legacy explicit transcription denial', async () => {
  const fake = fakePrisma({ affirmative: false });
  assert.equal(await appendVcRecapLocalWhisperSegmentIfConsented(fake.prisma, SEGMENT), false);
  assert.deepEqual(fake.steps, ['lock', 'consent']);
  assert.equal(fake.getInserts(), 0);
});

test('local Whisper refuses a persistent erasure fence even after an old consent is present', async () => {
  const fake = fakePrisma({ erasure: true });
  assert.equal(await appendVcRecapLocalWhisperSegmentIfConsented(fake.prisma, SEGMENT), false);
  assert.deepEqual(fake.steps, ['lock', 'consent', 'erasure']);
  assert.equal(fake.getInserts(), 0);
});

test('local Whisper rejects consent revoked while waiting for the owner lock', async () => {
  const state = { affirmative: true, personalRetention: true, erasure: false };
  // Capture the DB value after lock acquisition, rather than the stale
  // pre-transcription consent: use a dedicated mock with mutable state.
  const calls: string[] = [];
  let inserts = 0;
  const tx = {
    $queryRawUnsafe: async () => {
      calls.push('lock');
      state.affirmative = false;
      state.personalRetention = false;
      return [];
    },
    userDataConsent: {
      findUnique: async () => {
        calls.push('consent-after-lock');
        return {
          voiceTranscriptionConsent: state.affirmative,
          voiceTranscriptRetentionConsentedAt: state.personalRetention ? new Date() : null,
        };
      },
    },
    vcRecapErasureRequest: { findUnique: async () => null },
    vcRecapTranscriptSegment: {
      create: async () => {
        inserts += 1;
        throw new Error('must not insert after withdrawal');
      },
    },
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  assert.equal(await appendVcRecapLocalWhisperSegmentIfConsented(prisma, SEGMENT), false);
  assert.deepEqual(calls, ['lock', 'consent-after-lock']);
  assert.equal(inserts, 0);
});

test('local Whisper fails closed on consent DB outage, without writing a segment', async () => {
  const fake = fakePrisma({ failConsentRead: true });
  await assert.rejects(
    appendVcRecapLocalWhisperSegmentIfConsented(fake.prisma, SEGMENT),
    /database unavailable/,
  );
  assert.equal(fake.getInserts(), 0);
});

test('existing AWS transcript insertion remains on the unchanged legacy code path', async () => {
  const fake = fakePrisma({ affirmative: false, personalRetention: false, erasure: true });
  await appendVcRecapTranscriptSegment(fake.prisma, SEGMENT);
  assert.deepEqual(fake.steps, ['insert']);
  assert.equal(fake.getInserts(), 1);
});
