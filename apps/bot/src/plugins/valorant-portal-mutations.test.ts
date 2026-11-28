import { describe, expect, it } from 'vitest';
import {
  handleValorantPortalRequest,
  VALORANT_PORTAL_API_PREFIX,
  type ValorantPortalActionRecord,
  type ValorantPortalDeps,
  type ValorantPortalMemberInfo,
  type ValorantPortalMutationOutcome,
  type ValorantPortalOperations,
  type ValorantPortalPrisma,
  type ValorantPortalSessionRow,
} from './valorant-portal-api.js';

const GUILD_ID = '123456789012345678';
const ACTOR_ID = '234567890123456789';
const CREATOR_ID = '345678901234567890';
const TARGET_ID = '456789012345678901';
const PREFIX = VALORANT_PORTAL_API_PREFIX;

function sessionRow(overrides: Partial<ValorantPortalSessionRow> = {}): ValorantPortalSessionRow {
  return {
    id: 'session-1',
    guildId: GUILD_ID,
    channelId: '567890123456789012',
    messageId: '678901234567890123',
    creatorId: CREATOR_ID,
    status: 'OPEN',
    mode: 'RANDOM',
    mapId: null,
    voiceChannelId: null,
    trollOffUserIds: [],
    vcAutoJoin: false,
    maxParticipants: 5,
    expiresAt: new Date('2026-11-28T03:00:00.000Z'),
    completedAt: null,
    candidates: [],
    result: null,
    createdAt: new Date('2026-11-28T01:00:00.000Z'),
    updatedAt: new Date('2026-11-28T01:00:00.000Z'),
    participants: [],
    ...overrides,
  };
}

const actorMember: ValorantPortalMemberInfo = {
  userId: ACTOR_ID,
  displayName: 'アクター',
  isAdmin: false,
};
const creatorMember: ValorantPortalMemberInfo = {
  userId: CREATOR_ID,
  displayName: '作成者',
  isAdmin: false,
};
const targetMember: ValorantPortalMemberInfo = {
  userId: TARGET_ID,
  displayName: '対象者',
  isAdmin: false,
};

interface Harness {
  deps: ValorantPortalDeps;
  calls: string[];
  records: ValorantPortalActionRecord[];
  setOutcome: (method: string, outcome: ValorantPortalMutationOutcome) => void;
}

function createHarness(
  rows: ValorantPortalSessionRow[],
  members: ReadonlyMap<string, ValorantPortalMemberInfo>,
): Harness {
  const calls: string[] = [];
  const records: ValorantPortalActionRecord[] = [];
  const byKey = new Map<string, string>();
  const outcomes = new Map<string, ValorantPortalMutationOutcome>();
  const outcomeFor = (method: string, fallback: ValorantPortalMutationOutcome) =>
    outcomes.get(method) ?? fallback;

  const operations: ValorantPortalOperations = {
    createSession: async () => {
      calls.push('create');
      return outcomeFor('create', { status: 'ok', session: sessionRow({ id: 'created-1' }) });
    },
    joinSession: async (_actor, sessionId) => {
      calls.push('join');
      return outcomeFor('join', { status: 'ok', session: sessionRow({ id: sessionId }) });
    },
    leaveSession: async (_actor, sessionId) => {
      calls.push('leave');
      return outcomeFor('leave', { status: 'ok', session: sessionRow({ id: sessionId }) });
    },
    toggleTrollOff: async (_actor, sessionId) => {
      calls.push('troll-off');
      return outcomeFor('troll-off', { status: 'ok', session: sessionRow({ id: sessionId }) });
    },
    manageParticipants: async (_actor, sessionId, action) => {
      calls.push(`manage:${action}`);
      return outcomeFor('manage', { status: 'ok', session: sessionRow({ id: sessionId }) });
    },
    drawSession: async (_actor, sessionId) => {
      calls.push('draw');
      return outcomeFor('draw', {
        status: 'ok',
        session: sessionRow({ id: sessionId, status: 'COMPLETED' }),
      });
    },
    rerollSession: async () => {
      calls.push('reroll');
      return outcomeFor('reroll', {
        status: 'ok',
        session: sessionRow({ id: 'rerolled-1', status: 'COMPLETED' }),
      });
    },
    cancelSession: async (_actor, sessionId) => {
      calls.push('cancel');
      return outcomeFor('cancel', {
        status: 'ok',
        session: sessionRow({ id: sessionId, status: 'CANCELLED' }),
      });
    },
  };

  const prisma: ValorantPortalPrisma = {
    valorantPickSession: {
      findMany: async () => rows,
      findFirst: async (args: unknown) => {
        const { where } = args as { where: { id?: string } };
        return rows.find((row) => row.id === where.id) ?? null;
      },
    },
  };

  return {
    calls,
    records,
    setOutcome: (method, outcome) => outcomes.set(method, outcome),
    deps: {
      prisma,
      guildId: GUILD_ID,
      operations,
      actions: {
        findSessionIdByIdempotencyKey: async (key) => byKey.get(key) ?? null,
        recordAction: async (record) => {
          records.push(record);
          if (record.idempotencyKey) byKey.set(record.idempotencyKey, record.sessionId);
        },
      },
      guild: {
        getMember: async (userId) => members.get(userId) ?? null,
        listPostableTextChannels: async () => [],
        listVoiceChannels: async () => [],
        resolveDisplayNames: async () => new Map(),
      },
    },
  };
}

const members = new Map([
  [ACTOR_ID, actorMember],
  [CREATOR_ID, creatorMember],
  [TARGET_ID, targetMember],
]);

describe('valorant portal mutations (S6-H2)', () => {
  it('creates a session, records the portal action and requires an idempotency key', async () => {
    const harness = createHarness([], members);
    const missing = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/create`, {
      actorDiscordUserId: ACTOR_ID,
      channelId: '567890123456789012',
    });
    expect(missing.httpStatus).toBe(400);

    const created = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/create`, {
      actorDiscordUserId: ACTOR_ID,
      channelId: '567890123456789012',
      idempotencyKey: 'create-key-0001',
    });
    expect(created.httpStatus).toBe(200);
    expect((created.payload['session'] as { id: string }).id).toBe('created-1');
    expect(harness.records).toEqual([
      {
        sessionId: 'created-1',
        actorUserId: ACTOR_ID,
        action: 'create',
        idempotencyKey: 'create-key-0001',
      },
    ]);
  });

  it('replays a create with the same idempotency key without creating twice', async () => {
    const harness = createHarness([sessionRow({ id: 'created-1' })], members);
    const body = {
      actorDiscordUserId: ACTOR_ID,
      channelId: '567890123456789012',
      idempotencyKey: 'create-key-0002',
    };
    await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/create`, body);
    const replay = await handleValorantPortalRequest(
      harness.deps,
      `${PREFIX}/sessions/create`,
      body,
    );
    expect(replay.httpStatus).toBe(200);
    expect(replay.payload['idempotentReplay']).toBe(true);
    expect(harness.calls.filter((call) => call === 'create')).toHaveLength(1);
  });

  it('rejects invalid create input (bad map, werewolf mode, bad channel)', async () => {
    const harness = createHarness([], members);
    for (const body of [
      { channelId: '567890123456789012', mapId: 'NotAMap' },
      { channelId: '567890123456789012', mode: 'WEREWOLF' },
      { channelId: 'not-a-channel' },
    ]) {
      const response = await handleValorantPortalRequest(
        harness.deps,
        `${PREFIX}/sessions/create`,
        { actorDiscordUserId: ACTOR_ID, idempotencyKey: 'create-key-0003', ...body },
      );
      expect(response.httpStatus).toBe(400);
    }
    expect(harness.calls).toHaveLength(0);
  });

  it('joins and records the action with source handled by the store wiring', async () => {
    const harness = createHarness([sessionRow()], members);
    const response = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/join`, {
      actorDiscordUserId: ACTOR_ID,
      sessionId: 'session-1',
    });
    expect(response.httpStatus).toBe(200);
    expect(harness.records).toEqual([
      { sessionId: 'session-1', actorUserId: ACTOR_ID, action: 'join' },
    ]);
  });

  it('maps repository outcomes to HTTP errors (forbidden / closed / full / not_joined)', async () => {
    const harness = createHarness([sessionRow()], members);
    harness.setOutcome('draw', { status: 'forbidden' });
    const forbidden = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/draw`, {
      actorDiscordUserId: ACTOR_ID,
      sessionId: 'session-1',
    });
    expect(forbidden).toEqual({
      httpStatus: 403,
      payload: { status: 'error', error: 'forbidden' },
    });

    harness.setOutcome('join', { status: 'full' });
    const full = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/join`, {
      actorDiscordUserId: ACTOR_ID,
      sessionId: 'session-1',
    });
    expect(full.httpStatus).toBe(409);
    expect(full.payload['error']).toBe('full');

    harness.setOutcome('leave', { status: 'not_joined' });
    const notJoined = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/leave`, {
      actorDiscordUserId: ACTOR_ID,
      sessionId: 'session-1',
    });
    expect(notJoined.httpStatus).toBe(409);

    harness.setOutcome('cancel', { status: 'closed' });
    const closed = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/cancel`, {
      actorDiscordUserId: CREATOR_ID,
      sessionId: 'session-1',
    });
    expect(closed.httpStatus).toBe(409);
    // failed mutations are not recorded
    expect(harness.records).toHaveLength(0);
  });

  it('hides werewolf sessions from every mutation route', async () => {
    const harness = createHarness([sessionRow({ mode: 'WEREWOLF' })], members);
    for (const route of ['join', 'leave', 'troll-off', 'draw', 'cancel']) {
      const response = await handleValorantPortalRequest(
        harness.deps,
        `${PREFIX}/sessions/${route}`,
        { actorDiscordUserId: ACTOR_ID, sessionId: 'session-1' },
      );
      expect(response.httpStatus).toBe(404);
    }
    expect(harness.calls).toHaveLength(0);
  });

  it('rejects actors outside the guild before any mutation', async () => {
    const harness = createHarness([sessionRow()], new Map());
    const response = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/join`, {
      actorDiscordUserId: ACTOR_ID,
      sessionId: 'session-1',
    });
    expect(response.httpStatus).toBe(403);
    expect(response.payload['error']).toBe('actor_not_in_guild');
    expect(harness.calls).toHaveLength(0);
  });

  it('manages participants individually and rejects bulk or non-guild targets', async () => {
    const harness = createHarness([sessionRow()], members);
    const added = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/manage`, {
      actorDiscordUserId: CREATOR_ID,
      sessionId: 'session-1',
      action: 'add',
      targetUserId: TARGET_ID,
    });
    expect(added.httpStatus).toBe(200);
    expect(harness.calls).toEqual(['manage:add']);
    expect(harness.records[0]?.action).toBe('manage_add');

    const bulk = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/manage`, {
      actorDiscordUserId: CREATOR_ID,
      sessionId: 'session-1',
      action: 'bulk',
      targetUserId: TARGET_ID,
    });
    expect(bulk.httpStatus).toBe(400);

    const outsider = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/manage`, {
      actorDiscordUserId: CREATOR_ID,
      sessionId: 'session-1',
      action: 'add',
      targetUserId: '999999999999999999',
    });
    expect(outsider.httpStatus).toBe(400);
    expect(outsider.payload['error']).toBe('target_not_in_guild');
  });

  it('rerolls with an idempotency key and replays to the same new session', async () => {
    const harness = createHarness(
      [sessionRow({ status: 'COMPLETED' }), sessionRow({ id: 'rerolled-1', status: 'COMPLETED' })],
      members,
    );
    const body = {
      actorDiscordUserId: CREATOR_ID,
      sessionId: 'session-1',
      idempotencyKey: 'reroll-key-0001',
    };
    const first = await handleValorantPortalRequest(
      harness.deps,
      `${PREFIX}/sessions/reroll`,
      body,
    );
    expect(first.httpStatus).toBe(200);
    expect(first.payload['newSessionId']).toBe('rerolled-1');
    expect(first.payload['previousSessionId']).toBe('session-1');

    const replay = await handleValorantPortalRequest(
      harness.deps,
      `${PREFIX}/sessions/reroll`,
      body,
    );
    expect(replay.httpStatus).toBe(200);
    expect(replay.payload['newSessionId']).toBe('rerolled-1');
    expect(replay.payload['idempotentReplay']).toBe(true);
    expect(harness.calls.filter((call) => call === 'reroll')).toHaveLength(1);
  });

  it('requires an idempotency key for reroll', async () => {
    const harness = createHarness([sessionRow({ status: 'COMPLETED' })], members);
    const response = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/reroll`, {
      actorDiscordUserId: CREATOR_ID,
      sessionId: 'session-1',
    });
    expect(response.httpStatus).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });

  it('toggles troll-off for the actor and records it', async () => {
    const harness = createHarness([sessionRow()], members);
    const response = await handleValorantPortalRequest(
      harness.deps,
      `${PREFIX}/sessions/troll-off`,
      { actorDiscordUserId: ACTOR_ID, sessionId: 'session-1' },
    );
    expect(response.httpStatus).toBe(200);
    expect(harness.records).toEqual([
      { sessionId: 'session-1', actorUserId: ACTOR_ID, action: 'troll_off' },
    ]);
  });

  it('returns 503 for mutations when operations are not wired', async () => {
    const harness = createHarness([sessionRow()], members);
    delete harness.deps.operations;
    const response = await handleValorantPortalRequest(harness.deps, `${PREFIX}/sessions/join`, {
      actorDiscordUserId: ACTOR_ID,
      sessionId: 'session-1',
    });
    expect(response.httpStatus).toBe(503);
  });
});
