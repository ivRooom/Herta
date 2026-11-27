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
  findOpenValorantAutoJoinSessions,
  autoJoinValorantSession,
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

test(
  'real PostgreSQL: VC auto-join registration, opt-out, capacity and lifecycle (#1048)',
  {
    skip: !url,
  },
  async () => {
    const prisma = new PrismaClient({ datasourceUrl: url });
    const guildId = 'valorant-autojoin-integration-a';
    const otherGuild = 'valorant-autojoin-integration-b';
    const voiceChannelId = '123456789012345678';
    const otherVoiceChannelId = '987654321098765432';
    const alice = '111111111111111111';
    const bob = '222222222222222222';
    const charlie = '333333333333333333';
    const future = () => new Date(Date.now() + 60_000);
    const createAuto = (overrides: Partial<Parameters<typeof createValorantSession>[1]> = {}) =>
      createValorantSession(prisma, {
        guildId,
        channelId: 'channel',
        creatorId: 'owner',
        mode: 'RANDOM',
        mapId: null,
        maxParticipants: 5,
        expiresAt: future(),
        rulesVersion: 'integration-v1',
        voiceChannelId,
        vcAutoJoin: true,
        ...overrides,
      });
    const autoJoin = (id: string, userId: string, guild = guildId, vc = voiceChannelId) =>
      autoJoinValorantSession(prisma, { guildId: guild, id, userId, voiceChannelId: vc });

    try {
      await prisma.guild.createMany({
        data: [guildId, otherGuild].map((id) => ({ id, name: 'VALORANT synthetic integration' })),
      });

      // Normal registration through the finder + mutation pair.
      const session = await createAuto();
      const found = await findOpenValorantAutoJoinSessions(prisma, guildId, voiceChannelId);
      assert.deepEqual(
        found.map(({ id }) => id),
        [session.id],
      );
      const joined = await autoJoin(session.id, alice);
      assert.equal(joined.status, 'ok');
      if (joined.status === 'ok') {
        assert.equal(joined.changed, true);
        assert.equal(joined.becameFull, false);
        assert.deepEqual(
          joined.session.participants.map(({ userId }) => userId),
          [alice],
        );
      }
      // Re-joining the VC is idempotent.
      const repeat = await autoJoin(session.id, alice);
      assert.equal(repeat.status, 'ok');
      if (repeat.status === 'ok') assert.equal(repeat.changed, false);
      assert.equal((await getValorantSession(prisma, guildId, session.id))?.participants.length, 1);

      // A session without the opt-in is invisible to the finder and the
      // mutation refuses it even when called directly.
      const manualOnly = await createAuto({ vcAutoJoin: false });
      assert.equal(
        (await findOpenValorantAutoJoinSessions(prisma, guildId, voiceChannelId)).some(
          ({ id }) => id === manualOnly.id,
        ),
        false,
      );
      assert.equal((await autoJoin(manualOnly.id, alice)).status, 'not_auto');
      // A retargeted VC is rejected by the mutation re-check as well.
      assert.equal(
        (await autoJoin(session.id, bob, guildId, otherVoiceChannelId)).status,
        'not_auto',
      );
      assert.equal(
        (await findOpenValorantAutoJoinSessions(prisma, guildId, otherVoiceChannelId)).length,
        0,
      );
      // Guild separation: neither the finder nor the mutation crosses guilds.
      assert.equal(
        (await findOpenValorantAutoJoinSessions(prisma, otherGuild, voiceChannelId)).length,
        0,
      );
      assert.equal((await autoJoin(session.id, bob, otherGuild)).status, 'missing');

      // Opt-out: join manually, leave (records the opt-out), then a VC
      // re-join must not register the member NOR clear the opt-out.
      const optOut = await createAuto();
      assert.equal(
        (
          await mutateValorantSession(prisma, {
            guildId,
            id: optOut.id,
            userId: bob,
            action: 'join',
            isAdmin: false,
          })
        ).status,
        'ok',
      );
      assert.equal(
        (
          await mutateValorantSession(prisma, {
            guildId,
            id: optOut.id,
            userId: bob,
            action: 'leave',
            isAdmin: false,
          })
        ).status,
        'ok',
      );
      assert.equal((await autoJoin(optOut.id, bob)).status, 'opted_out');
      const optOutAfter = await getValorantSession(prisma, guildId, optOut.id);
      assert.deepEqual(optOutAfter?.optedOutUserIds, [bob]);
      assert.equal(optOutAfter?.participants.length, 0);

      // Capacity: the registration that fills the last seat reports
      // becameFull, keeps the session OPEN for the draw, and later joins
      // are refused.
      const tiny = await createAuto({ maxParticipants: 1 });
      const filled = await autoJoin(tiny.id, alice);
      assert.equal(filled.status, 'ok');
      if (filled.status === 'ok') assert.equal(filled.becameFull, true);
      assert.equal((await getValorantSession(prisma, guildId, tiny.id))?.status, 'OPEN');
      assert.equal((await autoJoin(tiny.id, bob)).status, 'full');

      // Lifecycle: completed, cancelled and expired sessions never register.
      const drawn = await createAuto();
      assert.equal((await autoJoin(drawn.id, alice)).status, 'ok');
      assert.equal(
        (
          await mutateValorantSession(prisma, {
            guildId,
            id: drawn.id,
            userId: 'owner',
            action: 'draw',
            isAdmin: false,
            candidates: [{ agentId: 'jett', agentName: 'Jett', displayName: 'ジェット' }],
            pick: (participants, pool) =>
              participants.map((userId, index) => ({ userId, ...pool[index]! })),
          })
        ).status,
        'ok',
      );
      assert.equal((await autoJoin(drawn.id, bob)).status, 'closed');

      const cancelled = await createAuto();
      assert.equal(
        (
          await mutateValorantSession(prisma, {
            guildId,
            id: cancelled.id,
            userId: 'owner',
            action: 'cancel',
            isAdmin: false,
          })
        ).status,
        'ok',
      );
      assert.equal((await autoJoin(cancelled.id, alice)).status, 'closed');

      const expired = await createAuto({ expiresAt: new Date(Date.now() - 10_000) });
      assert.equal((await autoJoin(expired.id, alice)).status, 'closed');
      assert.equal((await getValorantSession(prisma, guildId, expired.id))?.status, 'EXPIRED');

      // Concurrency: an auto-join and a manual join racing for the last
      // seat must never exceed capacity (shared row lock).
      const race = await createAuto({ maxParticipants: 1 });
      const raceResults = await Promise.allSettled([
        autoJoin(race.id, alice),
        mutateValorantSession(prisma, {
          guildId,
          id: race.id,
          userId: charlie,
          action: 'join',
          isAdmin: false,
        }),
      ]);
      assert.deepEqual(
        raceResults.map((r) => (r.status === 'fulfilled' ? r.value.status : 'rejected')).sort(),
        ['full', 'ok'],
      );
      assert.equal((await getValorantSession(prisma, guildId, race.id))?.participants.length, 1);
    } finally {
      await prisma.guild.deleteMany({ where: { id: { in: [guildId, otherGuild] } } });
      await prisma.$disconnect();
    }
  },
);
