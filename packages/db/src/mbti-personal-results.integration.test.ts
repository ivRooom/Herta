import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  saveMbtiCompletedResult,
  getMbtiPersonalHistory,
  getMbtiPersonalResult,
  issueMbtiResultAccess,
  resolveMbtiResultAccess,
} from './mbti-personal-results.js';
import { completeMbtiWebQuizSession } from './mbti-web-quiz-session.js';
const url = process.env.HERTA_MBTI_HISTORY_TEST_DATABASE_URL;
test(
  'personal MBTI history: migration, transactions, retries, subjects and access rotation',
  { skip: !url },
  async (t) => {
    const parsed = new URL(url!);
    assert(['127.0.0.1', 'localhost'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/mbti_personal_test');
    const prisma = new PrismaClient({ datasourceUrl: url });
    const subject = { guildId: 'history-test-guild', discordUserId: 'history-test-user' };
    const scores = { EI: -10, SN: -10, TF: -10, JP: -10, AT: -10 };
    const percentages = { EI: 31, SN: 31, TF: 29, JP: 29, AT: 29 };
    const questions = ['EI', 'SN', 'TF', 'JP', 'AT'].flatMap((axis) =>
      Array.from(
        { length: axis === 'AT' ? 12 : axis === 'EI' || axis === 'SN' ? 13 : 12 },
        (_, i) => ({ id: i, axis, prompt: 'synthetic' }),
      ),
    );
    const input = (key: string, completedAt = new Date()) => ({
      ...subject,
      completionKey: key,
      resultType: 'INFP',
      resultIdentity: 'T',
      scores,
      percentages,
      questionCount: 62,
      scoringVersion: 'likert-62-v1',
      source: 'discord' as const,
      completedAt,
    });
    const stats = {
      guildId: subject.guildId,
      resultType: 'INFP',
      eiScore: -10,
      snScore: -10,
      tfScore: -10,
      jpScore: -10,
      answers: [{ questionIndex: 1, axis: 'EI' as const, answer: 'agree' as const }],
    };
    try {
      await t.test(
        'additive migration restores completed 62-question web results without statistics',
        async () => {
          // This database is dedicated to this test and never contains production records.
          await prisma.$executeRawUnsafe(
            'DROP TABLE IF EXISTS mbti_result_access, mbti_personal_results',
          );
          await prisma.mbtiWebQuizSession.deleteMany({ where: subject });
          await prisma.mbtiQuizResultEvent.deleteMany({ where: { guildId: subject.guildId } });
          await prisma.mbtiQuestionAnswerEvent.deleteMany({ where: { guildId: subject.guildId } });
          const old = await prisma.mbtiWebQuizSession.create({
            data: {
              ...subject,
              questionOrder: questions,
              scores,
              status: 'completed',
              resultType: 'INFP',
              resultIdentity: 'T',
              completedAt: new Date('2026-10-01'),
              expiresAt: new Date('2026-10-02'),
            },
          });
          await prisma.mbtiWebQuizSession.createMany({
            data: [
              {
                ...subject,
                questionOrder: {},
                scores,
                status: 'completed',
                resultType: 'INFP',
                resultIdentity: 'T',
                completedAt: new Date('2026-10-17'),
                expiresAt: new Date(0),
              },
              {
                ...subject,
                questionOrder: questions,
                scores: { ...scores, EI: null },
                status: 'completed',
                resultType: 'INFP',
                resultIdentity: 'T',
                completedAt: new Date('2026-10-17'),
                expiresAt: new Date(0),
              },
            ],
          });
          const sql = await readFile(
            new URL(
              '../prisma/migrations/20261016110000_add_mbti_personal_history/migration.sql',
              import.meta.url,
            ),
            'utf8',
          );
          for (const statement of sql.split(';').filter((s) => s.trim()))
            await prisma.$executeRawUnsafe(statement);
          const result = await getMbtiPersonalResult(prisma, subject);
          assert.equal(result?.completionKey, `web:${old.id}`);
          assert.deepEqual(result?.percentages, percentages);
          assert.equal(
            await prisma.mbtiQuizResultEvent.count({ where: { guildId: subject.guildId } }),
            0,
          );
        },
      );
      await t.test(
        'new completion updates latest projection; older delivery never replaces it',
        async () => {
          await saveMbtiCompletedResult(prisma, input('latest', new Date('2026-10-16')), stats);
          await saveMbtiCompletedResult(
            prisma,
            input('older-delivered-last', new Date('2026-10-10')),
            stats,
          );
          assert.equal((await getMbtiPersonalResult(prisma, subject))?.completionKey, 'latest');
          assert.equal((await getMbtiPersonalHistory(prisma, subject)).length, 3);
          assert.equal(
            await prisma.mbtiQuizResultEvent.count({ where: { guildId: subject.guildId } }),
            2,
          );
        },
      );
      await t.test('concurrent retry records history and anonymous counts only once', async () => {
        await Promise.all(
          Array.from({ length: 4 }, () =>
            saveMbtiCompletedResult(prisma, input('duplicate', new Date('2026-10-15')), stats),
          ),
        );
        assert.equal(
          await prisma.mbtiPersonalResult.count({ where: { completionKey: 'duplicate' } }),
          1,
        );
        assert.equal(
          await prisma.mbtiQuizResultEvent.count({ where: { guildId: subject.guildId } }),
          3,
        );
        await assert.rejects(
          saveMbtiCompletedResult(prisma, input('rollback'), { ...stats, resultType: 'INVALID' }),
        );
        assert.equal(
          await prisma.mbtiPersonalResult.count({ where: { completionKey: 'rollback' } }),
          0,
        );
      });
      await t.test('subject restrictions cover record and cursor access', async () => {
        const latest = (await getMbtiPersonalResult(prisma, subject))!;
        const other = { ...subject, discordUserId: 'different-user' };
        assert.equal(await getMbtiPersonalResult(prisma, other, latest.id), null);
        assert.deepEqual(await getMbtiPersonalHistory(prisma, other, latest.id), []);
        await prisma.mbtiPersonalResult.createMany({
          data: Array.from({ length: 25 }, (_, i) => ({
            ...input(`page-${i}`, new Date('2026-10-05')),
            id: randomUUID(),
          })),
        });
        const first = await getMbtiPersonalHistory(prisma, subject);
        assert.equal(first.length, 21);
        const second = await getMbtiPersonalHistory(prisma, subject, first[19]!.id);
        assert.equal(new Set([...first.slice(0, 20), ...second].map((r) => r.id)).size, 29);
      });
      await t.test('links are hash-only, expire and rotate', async () => {
        const a = await issueMbtiResultAccess(prisma, subject.guildId, subject.discordUserId);
        assert.deepEqual(await resolveMbtiResultAccess(prisma, a.token), subject);
        const saved = await prisma.mbtiResultAccess.findFirst({ where: subject });
        assert.notEqual(saved?.tokenHash, a.token);
        const b = await issueMbtiResultAccess(prisma, subject.guildId, subject.discordUserId);
        assert.equal(await resolveMbtiResultAccess(prisma, a.token), null);
        await prisma.mbtiResultAccess.updateMany({
          where: subject,
          data: { expiresAt: new Date(0) },
        });
        assert.equal(await resolveMbtiResultAccess(prisma, b.token), null);
        assert.equal(await resolveMbtiResultAccess(prisma, 'invalid'), null);
      });
      await t.test(
        'web session completion atomically saves one history and one statistic; expiry cannot complete',
        async () => {
          const session = await prisma.mbtiWebQuizSession.create({
            data: {
              ...subject,
              questionOrder: questions,
              scores,
              expiresAt: new Date(Date.now() + 60000),
            },
          });
          const completion = {
            resultType: 'INFP',
            resultIdentity: 'T',
            history: { ...input(`web:${session.id}`), source: 'web' as const },
            stats,
          };
          const results = await Promise.all([
            completeMbtiWebQuizSession(prisma, session.id, completion),
            completeMbtiWebQuizSession(prisma, session.id, completion),
          ]);
          assert.equal(results.filter(Boolean).length, 1);
          assert.equal(
            await prisma.mbtiPersonalResult.count({
              where: { completionKey: completion.history.completionKey },
            }),
            1,
          );
          const expired = await prisma.mbtiWebQuizSession.create({
            data: { ...subject, questionOrder: [], expiresAt: new Date(0) },
          });
          assert.equal(await completeMbtiWebQuizSession(prisma, expired.id, completion), null);
        },
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
