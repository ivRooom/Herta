import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@herta/db';
import {
  createValorantSession,
  createDirectValorantSession,
  rerollValorantSession,
  setValorantSessionMessageId,
  getValorantSession,
  mutateValorantSession,
  bindValorantVoiceChannel,
  manageValorantParticipants,
} from './valorant-session-repository.js';

const url = process.env.HERTA_VALORANT_TEST_DATABASE_URL;
test(
  'real PostgreSQL: enrollment, creator IAM, guild separation, expiry and concurrent draws',
  {
    skip: !url,
  },
  async () => {
    const parsed = new URL(url!);
    assert(['localhost', '127.0.0.1'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/valorant_test');
    const prisma = new PrismaClient({ datasourceUrl: url });
    const guildId = 'valorant-session-integration-a';
    const otherGuild = 'valorant-session-integration-b';
    const future = () => new Date(Date.now() + 60_000);
    const create = (maxParticipants = 5, expiresAt = future()) =>
      createValorantSession(prisma, {
        guildId,
        channelId: 'channel',
        creatorId: 'owner',
        mode: 'RANDOM',
        mapId: null,
        maxParticipants,
        expiresAt,
        rulesVersion: 'integration-v1',
      });
    const candidates = [
      { agentId: 'jett', agentName: 'Jett', displayName: 'ジェット' },
      { agentId: 'omen', agentName: 'Omen', displayName: 'オーメン' },
    ];
    const operate = (
      id: string,
      userId: string,
      action: 'join' | 'leave' | 'draw' | 'cancel',
      isAdmin = false,
    ) =>
      mutateValorantSession(prisma, {
        guildId,
        id,
        userId,
        action,
        isAdmin,
        candidates,
        pick(participants, pool) {
          return participants.map((userId, index) => ({
            userId,
            ...pool[index]!,
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
      assert.equal(await getValorantSession(prisma, otherGuild, session.id), null);
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

      await setValorantSessionMessageId(prisma, guildId, session.id, 'reroll-message');
      const reroll = (id: string, userId: string, isAdmin = false) =>
        rerollValorantSession(prisma, {
          guildId,
          id,
          messageId: 'reroll-message',
          userId,
          isAdmin,
          candidates,
          sessionDurationMinutes: 30,
          rulesVersion: 'integration-v2',
          pick(participants, pool) {
            return participants.map((uid, index) => ({ userId: uid, ...pool[index]! }));
          },
        });
      assert.equal((await reroll(session.id, 'guest')).status, 'forbidden');
      const rerolls = await Promise.all([reroll(session.id, 'owner'), reroll(session.id, 'owner')]);
      const successful = rerolls.filter((r) => r.status === 'ok');
      assert.equal(successful.length, 1);
      const successor = successful[0]!;
      if (successor.status !== 'ok') throw new Error('reroll missing');
      assert.equal(successor.session.status, 'COMPLETED');
      assert.equal(successor.session.messageId, 'reroll-message');
      assert.equal(successor.session.participants.length, 2);
      assert.notEqual(successor.session.id, session.id);
      assert.equal((await getValorantSession(prisma, guildId, session.id))?.messageId, null);
      assert.deepEqual(
        (await getValorantSession(prisma, guildId, session.id))?.result,
        final?.result,
      );
      assert.equal((await reroll(session.id, 'owner')).status, 'closed');
      assert.equal((await reroll(successor.session.id, 'owner')).status, 'ok');
      assert.equal(await getValorantSession(prisma, otherGuild, successor.session.id), null);

      const direct = await createDirectValorantSession(prisma, {
        guildId,
        channelId: 'channel',
        creatorId: 'owner',
        mode: 'RANDOM',
        mapId: null,
        expiresAt: future(),
        rulesVersion: 'direct-v1',
        participants: ['alice', 'bob'],
        candidates,
        assignments: [
          { userId: 'alice', ...candidates[0]! },
          { userId: 'bob', ...candidates[1]! },
        ],
      });
      assert.equal(direct.status, 'COMPLETED');
      assert.equal(direct.participants.length, 2);
      assert.equal((direct.result as unknown[]).length, 2);
      await setValorantSessionMessageId(prisma, guildId, direct.id, 'direct-message');

      // VC membership and explicit opt-out are serialized with join/draw on the same DB row.
      const voiceChannelId = '123456789012345678';
      const alice = '111111111111111111';
      const bob = '222222222222222222';
      const charlie = '333333333333333333';
      const diana = '444444444444444444';
      const vc = await create(2);
      assert.equal(
        (
          await bindValorantVoiceChannel(prisma, {
            guildId,
            id: vc.id,
            userId: 'guest',
            isAdmin: false,
            channelId: voiceChannelId,
          })
        ).status,
        'forbidden',
      );
      assert.equal(
        (
          await bindValorantVoiceChannel(prisma, {
            guildId,
            id: vc.id,
            userId: 'owner',
            isAdmin: false,
            channelId: voiceChannelId,
          })
        ).status,
        'ok',
      );
      assert.equal(
        (
          await bindValorantVoiceChannel(prisma, {
            guildId,
            id: vc.id,
            userId: 'owner',
            isAdmin: false,
            channelId: '555555555555555555',
          })
        ).status,
        'voice_changed',
      );
      assert.equal(
        (
          await manageValorantParticipants(prisma, {
            guildId: otherGuild,
            id: vc.id,
            userId: 'owner',
            isAdmin: true,
            action: 'bulk',
            targetIds: [bob],
            expectedVoiceChannelId: voiceChannelId,
          })
        ).status,
        'missing',
      );
      assert.equal((await operate(vc.id, alice, 'join')).status, 'ok');
      assert.equal((await operate(vc.id, alice, 'leave')).status, 'ok');
      const auto = await manageValorantParticipants(prisma, {
        guildId,
        id: vc.id,
        userId: 'owner',
        isAdmin: false,
        action: 'bulk',
        targetIds: [alice, bob],
        expectedVoiceChannelId: voiceChannelId,
      });
      assert.equal(auto.status, 'ok');
      if (auto.status === 'ok') {
        assert.deepEqual(
          auto.session.participants.map(({ userId }) => userId),
          [bob],
        );
        assert.deepEqual(auto.session.optedOutUserIds, [alice]);
      }
      const autoRepeat = await manageValorantParticipants(prisma, {
        guildId,
        id: vc.id,
        userId: 'owner',
        isAdmin: false,
        action: 'bulk',
        targetIds: [alice, bob],
        expectedVoiceChannelId: voiceChannelId,
      });
      assert.equal(autoRepeat.status, 'ok');
      if (autoRepeat.status === 'ok') assert.equal(autoRepeat.changed, false);
      assert.equal(
        (
          await manageValorantParticipants(prisma, {
            guildId,
            id: vc.id,
            userId: 'guest',
            isAdmin: false,
            action: 'add',
            targetIds: [alice],
          })
        ).status,
        'forbidden',
      );
      assert.equal(
        (
          await manageValorantParticipants(prisma, {
            guildId,
            id: vc.id,
            userId: 'owner',
            isAdmin: false,
            action: 'add',
            targetIds: [alice],
          })
        ).status,
        'ok',
      );
      assert.deepEqual((await getValorantSession(prisma, guildId, vc.id))?.optedOutUserIds, []);
      assert.equal(
        (
          await manageValorantParticipants(prisma, {
            guildId,
            id: vc.id,
            userId: 'owner',
            isAdmin: true,
            action: 'bulk',
            targetIds: [charlie],
            expectedVoiceChannelId: voiceChannelId,
          })
        ).status,
        'full',
      );
      assert.equal(
        (
          await manageValorantParticipants(prisma, {
            guildId,
            id: vc.id,
            userId: 'owner',
            isAdmin: false,
            action: 'remove',
            targetIds: [alice],
          })
        ).status,
        'ok',
      );
      assert.equal(
        (
          await manageValorantParticipants(prisma, {
            guildId,
            id: vc.id,
            userId: 'owner',
            isAdmin: false,
            action: 'bulk',
            targetIds: [alice],
            expectedVoiceChannelId: voiceChannelId,
          })
        ).status,
        'ok',
      );
      assert.equal((await operate(vc.id, 'owner', 'draw')).status, 'ok');
      assert.equal(
        (
          await manageValorantParticipants(prisma, {
            guildId,
            id: vc.id,
            userId: 'owner',
            isAdmin: true,
            action: 'remove',
            targetIds: [bob],
          })
        ).status,
        'closed',
      );

      // Concurrent manual adds must not exceed the configured Guild cap.
      const race = await create(1);
      const raceResults = await Promise.all([
        manageValorantParticipants(prisma, {
          guildId,
          id: race.id,
          userId: 'owner',
          isAdmin: true,
          action: 'add',
          targetIds: [charlie],
        }),
        manageValorantParticipants(prisma, {
          guildId,
          id: race.id,
          userId: 'owner',
          isAdmin: true,
          action: 'add',
          targetIds: [diana],
        }),
      ]);
      assert.deepEqual(raceResults.map((r) => r.status).sort(), ['full', 'ok']);
      assert.equal((await getValorantSession(prisma, guildId, race.id))?.participants.length, 1);

      const expired = await create(5, new Date(Date.now() - 10_000));
      assert.equal((await operate(expired.id, 'alice', 'join')).status, 'closed');
      assert.equal((await getValorantSession(prisma, guildId, expired.id))?.status, 'EXPIRED');
    } finally {
      await prisma.guild.deleteMany({ where: { id: { in: [guildId, otherGuild] } } });
      await prisma.$disconnect();
    }
  },
);
