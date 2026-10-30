import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@herta/db';
import {
  createValorantSession,
  getValorantSession,
  mutateValorantSession,
} from './valorant-session-repository.js';

const url = process.env.HERTA_VALORANT_TEST_DATABASE_URL;
test('real PostgreSQL: enrollment, creator IAM, guild separation, expiry and concurrent draws', {
  skip: !url,
}, async () => {
  const parsed = new URL(url!);
  assert(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/valorant_test');
  const prisma = new PrismaClient({ datasourceUrl: url });
  const guildId = 'valorant-session-integration-a';
  const otherGuild = 'valorant-session-integration-b';
  const future = () => new Date(Date.now() + 60_000);
  const create = (maxParticipants = 5, expiresAt = future()) =>
    createValorantSession(prisma, {
      guildId, channelId: 'channel', creatorId: 'owner',
      mode: 'RANDOM', mapId: null, maxParticipants, expiresAt,
      rulesVersion: 'integration-v1',
    });
  const candidates = [
    { agentId: 'jett', agentName: 'Jett', displayName: 'ジェット' },
    { agentId: 'omen', agentName: 'Omen', displayName: 'オーメン' },
  ];
  const operate = (
    id: string, userId: string, action: 'join' | 'leave' | 'draw' | 'cancel',
    isAdmin = false,
  ) => mutateValorantSession(prisma, {
    guildId, id, userId, action, isAdmin, candidates,
    pick(participants, pool) {
      return participants.map((userId, index) => ({
        userId, ...pool[index]!,
      }));
    },
  });

  try {
    await prisma.guild.createMany({
      data: [guildId, otherGuild].map((id) => ({ id, name: 'VALORANT synthetic integration' })),
    });
    const empty = await create();
    assert.equal((await operate(empty.id, 'owner', 'draw')).status, 'empty');
    assert.equal((await operate(empty.id, 'guest', 'cancel')).status, 'forbidden');
    assert.equal((await operate(empty.id, 'owner', 'cancel')).status, 'ok');
    assert.equal((await operate(empty.id, 'guest', 'join')).status, 'closed');

    const session = await create(2);
    assert.equal((await getValorantSession(prisma, otherGuild, session.id)), null);
    const first = await operate(session.id, 'alice', 'join');
    assert.equal(first.status, 'ok');
    const duplicate = await operate(session.id, 'alice', 'join');
    assert.equal(duplicate.status, 'ok');
    if (duplicate.status === 'ok') assert.equal(duplicate.changed, false);
    assert.equal((await operate(session.id, 'charlie', 'leave')).status, 'not_joined');
    assert.equal((await operate(session.id, 'guest', 'draw')).status, 'forbidden');
    const second = await operate(session.id, 'bob', 'join');
    assert.equal(second.status, 'ok');
    assert.equal((await operate(session.id, 'charlie', 'join')).status, 'full');
    const results = await Promise.allSettled([
      operate(session.id, 'owner', 'draw'),
      operate(session.id, 'owner', 'draw'),
    ]);
    assert.equal(
      results.filter((item) => item.status === 'fulfilled' && item.value.status === 'ok').length,
      1,
    );
    const final = await getValorantSession(prisma, guildId, session.id);
    assert.equal(final?.status, 'COMPLETED');
    assert.equal(final?.participants.length, 2);
    assert.equal(Array.isArray(final?.result), true);
    assert.equal((final?.result as unknown[]).length, 2);
    assert.equal((await operate(session.id, 'alice', 'leave')).status, 'closed');

    const expired = await create(5, new Date(Date.now() - 10_000));
    assert.equal((await operate(expired.id, 'alice', 'join')).status, 'closed');
    assert.equal((await getValorantSession(prisma, guildId, expired.id))?.status, 'EXPIRED');
  } finally {
    await prisma.guild.deleteMany({ where: { id: { in: [guildId, otherGuild] } } });
    await prisma.$disconnect();
  }
});
