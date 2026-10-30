import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { anonymizeOldValorantSessions, redactValorantIdentifiers } from './valorant-retention.js';

test('VALORANT retention scrubs nested IDs but preserves agent and KDA data', () => {
  assert.deepEqual(
    redactValorantIdentifiers([
      { userId: '12345', agentId: 'jett', kills: 12, nested: { userId: '56789' } },
    ]),
    [{ agentId: 'jett', kills: 12, nested: {} }],
  );
});

test('90-day retention updates terminal session and match but does not delete history', async () => {
  const actions: Array<{ name: string; data?: unknown }> = [];
  const tx = {
    valorantPickSession: {
      updateMany: async (input: { data: unknown }) => {
        actions.push({ name: 'session', data: input.data });
        return { count: 1 };
      },
    },
    valorantPickParticipant: {
      deleteMany: async () => {
        actions.push({ name: 'participants' });
        return { count: 1 };
      },
    },
    valorantMatchResult: {
      findUnique: async () => ({
        playerResults: [{ userId: '12345', agentId: 'omen', kills: 10 }],
      }),
      update: async (input: { data: unknown }) => {
        actions.push({ name: 'match', data: input.data });
        return {};
      },
    },
  };
  const prisma = {
    valorantPickSession: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [
        {
          id: 'synthetic-session',
          guildId: 'synthetic-guild',
          result: [{ userId: '12345', agentId: 'jett' }],
        },
      ],
    },
    $transaction: async (cb: (arg: typeof tx) => Promise<boolean>) => cb(tx),
  } as unknown as PrismaClient;
  assert.equal(await anonymizeOldValorantSessions(prisma, new Date('2027-03-01'), 1), 1);
  assert.deepEqual(
    actions.map((item) => item.name),
    ['session', 'participants', 'match'],
  );
  assert.deepEqual(actions[0]?.data, {
    creatorId: 'redacted',
    result: [{ agentId: 'jett' }],
  });
  assert.deepEqual(actions[2]?.data, {
    enteredBy: 'redacted',
    matchId: null,
    playerResults: [{ agentId: 'omen', kills: 10 }],
  });
});
