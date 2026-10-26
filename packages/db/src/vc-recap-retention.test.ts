import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  getVoiceTranscriptRetentionUserIds,
  setVoiceTranscriptionConsent,
} from './user-data-consent.js';
import {
  VC_RECAP_TRANSCRIPT_RETENTION_DAYS,
  completeVcRecapSession,
  countVcRecapTranscriptSegments,
  failVcRecapSession,
  getVcRecapSessionTranscriptForGuild,
  purgeExpiredVcRecapTranscripts,
} from './vc-recap.js';

function fakePrisma() {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const record =
    (model: string, method: string, result: unknown = { count: 0 }) =>
    async (args: unknown) => {
      calls.push({ model, method, args });
      return result;
    };
  const consentRow = {
    userId: 'user-1',
    voiceTranscriptionConsent: true,
    voiceTranscriptRetentionConsentedAt: null,
    updatedAt: new Date(0),
  };
  const prisma = {
    vcRecapSession: { update: record('vcRecapSession', 'update') },
    vcRecapTranscriptSegment: { deleteMany: record('vcRecapTranscriptSegment', 'deleteMany') },
    userDataConsent: {
      upsert: record('userDataConsent', 'upsert', consentRow),
      findMany: record('userDataConsent', 'findMany', [{ userId: 'user-1' }]),
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaClient;
  return { prisma, calls };
}

test('要約完了時は本文保存に同意した参加者以外のsegmentを削除する', async () => {
  const { prisma, calls } = fakePrisma();
  await completeVcRecapSession(prisma, 'session-1', {
    summary: '要約',
    topics: [],
    retainedUserIds: ['user-1'],
  });

  const deleteCall = calls.find((call) => call.method === 'deleteMany');
  assert.deepEqual(deleteCall?.args, {
    where: { sessionId: 'session-1', userId: { notIn: ['user-1'] } },
  });
});

test('本文保存の同意者がいなければ要約完了・失敗時にsegmentを全て削除する', async () => {
  const { prisma, calls } = fakePrisma();
  await completeVcRecapSession(prisma, 'session-1', { summary: '要約', topics: [] });
  await failVcRecapSession(prisma, 'session-2');

  assert.deepEqual(
    calls.filter((call) => call.method === 'deleteMany').map((call) => call.args),
    [{ where: { sessionId: 'session-1' } }, { where: { sessionId: 'session-2' } }],
  );
});

test('保持期間を過ぎた終了済みセッションのsegmentだけを削除する', async () => {
  const { prisma, calls } = fakePrisma();
  const now = new Date('2026-11-30T00:00:00.000Z');
  await purgeExpiredVcRecapTranscripts(prisma, now);

  const cutoff = new Date(now.getTime() - VC_RECAP_TRANSCRIPT_RETENTION_DAYS * 86_400_000);
  assert.deepEqual(calls[0]?.args, { where: { session: { endedAt: { lt: cutoff } } } });
});

test('本人が保存の説明を見て同意した場合だけ本文保存の同意日時を記録する', async () => {
  const { prisma, calls } = fakePrisma();
  await setVoiceTranscriptionConsent(prisma, 'user-1', true, { transcriptRetention: true });
  await setVoiceTranscriptionConsent(prisma, 'user-1', true);

  const [withRetention, withoutRetention] = calls
    .filter((call) => call.method === 'upsert')
    .map((call) => (call.args as { update: Record<string, unknown> }).update);
  assert.ok(withRetention?.['voiceTranscriptRetentionConsentedAt'] instanceof Date);
  assert.deepEqual(withoutRetention, { voiceTranscriptionConsent: true });
});

test('同意の取り消しは本文保存の同意を外し、保存済みの本人の本文も削除する', async () => {
  const { prisma, calls } = fakePrisma();
  await setVoiceTranscriptionConsent(prisma, 'user-1', false);

  const upsert = calls.find((call) => call.method === 'upsert');
  assert.deepEqual((upsert?.args as { update: unknown }).update, {
    voiceTranscriptionConsent: false,
    voiceTranscriptRetentionConsentedAt: null,
  });
  assert.deepEqual(calls.find((call) => call.method === 'deleteMany')?.args, {
    where: { userId: 'user-1' },
  });
});

test('本文保存の同意者は明示的な同意と保存同意の両方を持つユーザーに限る', async () => {
  const { prisma, calls } = fakePrisma();
  const result = await getVoiceTranscriptRetentionUserIds(prisma, ['user-1', 'user-1', 'user-2']);

  assert.deepEqual([...result], ['user-1']);
  assert.deepEqual(calls[0]?.args, {
    where: {
      userId: { in: ['user-1', 'user-2'] },
      voiceTranscriptionConsent: true,
      voiceTranscriptRetentionConsentedAt: { not: null },
    },
    select: { userId: true },
  });
});

test('Studioへは終了済みかつ保持期間内のセッションの本文だけを出す', async () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const segment = {
    userId: 'user-1',
    text: 'こんにちは',
    startedAt: new Date(0),
    endedAt: new Date(1000),
  };
  const sessionRow = (endedAt: Date | null) => ({
    id: 'session-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    startedBy: 'user-1',
    status: endedAt ? 'completed' : 'active',
    consentingUserIds: ['user-1'],
    nonConsentingUserIds: [],
    summary: null,
    topics: [],
    startedAt: new Date(0),
    endedAt,
    segments: [segment],
  });
  let row = sessionRow(null);
  let groupByArgs: unknown;
  const prisma = {
    vcRecapSession: { findFirst: async () => row },
    vcRecapTranscriptSegment: {
      groupBy: async (args: unknown) => {
        groupByArgs = args;
        return [];
      },
    },
  } as unknown as PrismaClient;
  const read = async () =>
    (await getVcRecapSessionTranscriptForGuild(prisma, 'guild-1', 'session-1', now))?.segments;

  // 未終了: 本文保存に同意していない参加者の本文がまだ残っている
  assert.deepEqual(await read(), []);
  // 終了から30日以内
  row = sessionRow(new Date('2026-07-15T00:00:00.000Z'));
  assert.deepEqual(await read(), [segment]);
  // 30日を過ぎたが削除ジョブがまだ動いていない
  row = sessionRow(new Date('2026-07-01T00:00:00.000Z'));
  assert.deepEqual(await read(), []);

  await countVcRecapTranscriptSegments(prisma, ['session-1'], now);
  assert.deepEqual(groupByArgs, {
    by: ['sessionId'],
    where: {
      sessionId: { in: ['session-1'] },
      session: { endedAt: { not: null, gt: new Date('2026-07-02T00:00:00.000Z') } },
    },
    _count: { _all: true },
  });
});
