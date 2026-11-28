import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  anonymizeOldValorantSessions,
  anonymizeWerewolfGameData,
  redactValorantIdentifiers,
} from './valorant-retention.js';

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
    optedOutUserIds: [],
    voiceChannelId: null,
    result: [{ agentId: 'jett' }],
  });
  assert.deepEqual(actions[2]?.data, {
    enteredBy: 'redacted',
    matchId: null,
    playerResults: [{ agentId: 'omen', kills: 10 }],
  });
});

test('90-day retention anonymizes portal session action actors (#1050 S6-H2)', async () => {
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
    valorantPickSessionAction: {
      updateMany: async (input: { where: unknown; data: unknown }) => {
        actions.push({ name: 'session-actions', data: input.data });
        return { count: 2 };
      },
    },
    valorantMatchResult: {
      findUnique: async () => null,
      update: async () => ({}),
    },
  };
  const prisma = {
    valorantPickSession: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [
        { id: 'portal-session', guildId: 'synthetic-guild', result: null, mode: 'RANDOM' },
      ],
    },
    $transaction: async (cb: (arg: typeof tx) => Promise<boolean>) => cb(tx),
  } as unknown as PrismaClient;
  assert.equal(await anonymizeOldValorantSessions(prisma, new Date('2027-03-01'), 1), 1);
  assert.deepEqual(
    actions.map((item) => item.name),
    ['session', 'participants', 'session-actions'],
  );
  assert.deepEqual(actions[2]?.data, { actorUserId: 'redacted' });
});

test('werewolf game anonymization drops every identifier but keeps counts (#1049)', () => {
  const scrubbed = anonymizeWerewolfGameData({
    rosterSnapshot: [
      { userId: '111', displayName: 'Alice' },
      { userId: '222', displayName: 'Bob' },
      { userId: '333', displayName: 'Carol' },
    ],
    roundHistory: [
      {
        round: 1,
        candidateUserIds: ['111', '222', '333'],
        tally: { '111': 0, '222': 2, '333': 1 },
        votedCount: 3,
        rosterSize: 3,
        closeReason: 'all_voted',
      },
    ],
    firstRoundTally: { '111': 0, '222': 2, '333': 1 },
  });
  assert.deepEqual(scrubbed.rosterSnapshot, { anonymized: true, size: 3 });
  assert.deepEqual(scrubbed.roundHistory, [
    { round: 1, tally: [0, 2, 1], votedCount: 3, rosterSize: 3, closeReason: 'all_voted' },
  ]);
  assert.deepEqual(scrubbed.firstRoundTally, [0, 2, 1]);
  const serialized = JSON.stringify(scrubbed);
  for (const identifier of ['111', '222', '333', 'Alice', 'Bob', 'Carol', 'candidateUserIds']) {
    assert.equal(serialized.includes(identifier), false, identifier);
  }
});

test('90-day retention deletes werewolf votes and secrets and scrubs the game (#1049)', async () => {
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
        return { count: 3 };
      },
    },
    valorantWerewolfVote: {
      deleteMany: async () => {
        actions.push({ name: 'votes' });
        return { count: 3 };
      },
    },
    valorantWerewolfSecret: {
      deleteMany: async () => {
        actions.push({ name: 'secrets' });
        return { count: 1 };
      },
    },
    valorantWerewolfGame: {
      findUnique: async () => ({
        rosterSnapshot: [{ userId: '111', displayName: 'Alice' }],
        roundHistory: [],
        firstRoundTally: null,
      }),
      update: async (input: { data: unknown }) => {
        actions.push({ name: 'game', data: input.data });
        return {};
      },
    },
    valorantMatchResult: {
      findUnique: async () => null,
      update: async () => ({}),
    },
  };
  const prisma = {
    valorantPickSession: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [
        { id: 'wolf-session', guildId: 'synthetic-guild', result: null, mode: 'WEREWOLF' },
      ],
    },
    $transaction: async (cb: (arg: typeof tx) => Promise<boolean>) => cb(tx),
  } as unknown as PrismaClient;
  assert.equal(await anonymizeOldValorantSessions(prisma, new Date('2027-03-01'), 1), 1);
  assert.deepEqual(
    actions.map((item) => item.name),
    ['session', 'participants', 'votes', 'secrets', 'game'],
  );
  const gameUpdate = actions.find((item) => item.name === 'game')?.data as {
    rosterSnapshot: unknown;
    accusedUserId: unknown;
    punishmentUserId: unknown;
  };
  assert.deepEqual(gameUpdate.rosterSnapshot, { anonymized: true, size: 1 });
  assert.equal(gameUpdate.accusedUserId, null);
  assert.equal(gameUpdate.punishmentUserId, null);
});
