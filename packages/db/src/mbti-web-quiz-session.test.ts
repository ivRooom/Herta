import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  createMbtiWebQuizSession,
  getOrCreateMbtiWebQuizSession,
  appendMbtiWebQuizAnswer,
  resolveMbtiWebQuizSessionForAnswer,
} from './mbti-web-quiz-session.js';

test(
  'concurrent member links share one pending session without crossing subjects',
  {
    skip: !process.env.MBTI_MEMBER_LINK_TEST_DATABASE_URL,
  },
  async () => {
    const url = new URL(process.env.MBTI_MEMBER_LINK_TEST_DATABASE_URL!);
    assert(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.equal(url.pathname, '/mbti_member_link_test');
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasourceUrl: url.toString() });
    const guildId = `member-link-test-${crypto.randomUUID()}`;
    try {
      const input = {
        guildId,
        discordUserId: 'fixture-one',
        questions: [{ id: 1, axis: 'EI', prompt: 'fixture' }],
      };
      const sessions = await Promise.all(
        Array.from({ length: 8 }, () => getOrCreateMbtiWebQuizSession(prisma, input)),
      );
      assert.equal(new Set(sessions.map((s) => s.id)).size, 1);
      assert.equal(sessions.filter((s) => !s.resumed).length, 1);
      assert.equal(await prisma.mbtiWebQuizSession.count({ where: { guildId } }), 1);
      const other = await getOrCreateMbtiWebQuizSession(prisma, {
        ...input,
        discordUserId: 'fixture-two',
      });
      assert.notEqual(other.id, sessions[0]!.id);
      assert.equal(other.resumed, false);
    } finally {
      await prisma.mbtiWebQuizSession.deleteMany({ where: { guildId } });
      await prisma.$disconnect();
    }
  },
);

test('new sessions retain original question snapshots and have a 24 hour resume window', async () => {
  let data: { questionOrder: unknown; expiresAt: Date } | undefined;
  const prisma = {
    mbtiWebQuizSession: {
      create: async (args: { data: { questionOrder: unknown; expiresAt: Date } }) => {
        data = args.data;
        return { id: 'session', expiresAt: data.expiresAt };
      },
    },
  } as unknown as PrismaClient;
  const questions = [
    { id: 500, axis: 'EI', prompt: 'snapshot', direction: -1 as const, facet: 'social-energy' },
  ];
  const before = Date.now();
  await createMbtiWebQuizSession(prisma, { guildId: 'guild', discordUserId: 'user', questions });
  assert(data);
  assert.deepEqual(data.questionOrder, questions);
  assert(data.expiresAt.getTime() >= before + 24 * 60 * 60 * 1000);
  assert(data.expiresAt.getTime() <= Date.now() + 24 * 60 * 60 * 1000);
});

test('saved answers survive a new session read, including frozen scoring direction', async () => {
  const saved = {
    id: 'session',
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
    questionOrder: [{ id: 500, direction: -1 }],
    answers: [{ questionIndex: 500, axis: 'EI', answer: 'agree' }],
    scores: { EI: -2 },
  };
  const prisma = {
    mbtiWebQuizSession: { findUnique: async () => structuredClone(saved) },
  } as unknown as PrismaClient;
  for (let visit = 0; visit < 2; visit++) {
    const resolution = await resolveMbtiWebQuizSessionForAnswer(prisma, 'session');
    assert(resolution.ok);
    assert.equal(resolution.session.answers.length, 1);
    assert.equal(resolution.session.scores.EI, -2);
    assert.equal(resolution.session.questionOrder[0]?.direction, -1);
  }
});

test('append compares the previous snapshot and checks the expiry atomically', async () => {
  const previous = [{ questionIndex: 500, axis: 'EI', answer: 'agree' }];
  const next = [...previous, { questionIndex: 501, axis: 'SN', answer: 'neutral' }];
  let where: { answers: { equals: unknown }; status: string; expiresAt: { gt: Date } } | undefined;
  const prisma = {
    mbtiWebQuizSession: {
      updateMany: async (args: {
        where: { answers: { equals: unknown }; status: string; expiresAt: { gt: Date } };
      }) => {
        where = args.where;
        return { count: 0 };
      },
      findUnique: async () => {
        throw new Error('must not read after failed guard');
      },
    },
  } as unknown as PrismaClient;
  const result = await appendMbtiWebQuizAnswer(prisma, 'session', next, { EI: -2 }, previous);
  assert.equal(result, null);
  assert(where);
  assert.deepEqual(where.answers.equals, previous);
  assert.equal(where.status, 'pending');
  assert(where.expiresAt.gt instanceof Date);
});

test('expired sessions cannot resume and are marked expired', async () => {
  let expired = false;
  const prisma = {
    mbtiWebQuizSession: {
      findUnique: async () => ({ status: 'pending', expiresAt: new Date(0) }),
      updateMany: async () => {
        expired = true;
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  assert.deepEqual(await resolveMbtiWebQuizSessionForAnswer(prisma, 'session'), {
    ok: false,
    reason: 'expired',
  });
  assert(expired);
});
