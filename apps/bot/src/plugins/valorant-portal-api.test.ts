import { describe, expect, it } from 'vitest';
import {
  computeValorantPortalSignature,
  handleValorantPortalRequest,
  loadValorantPortalApiConfig,
  verifyValorantPortalRequest,
  VALORANT_PORTAL_API_PREFIX,
  type ValorantPortalDeps,
  type ValorantPortalMemberInfo,
  type ValorantPortalPrisma,
  type ValorantPortalSessionRow,
} from './valorant-portal-api.js';

const GUILD_ID = '123456789012345678';
const ACTOR_ID = '234567890123456789';
const OTHER_ID = '345678901234567890';
const SECRET = 'portal-test-secret-value-0123456789';
const NOW = Date.parse('2026-11-28T00:00:00.000Z');

function sign(secret: string, timestamp: string, body: string, pathname: string): string {
  return computeValorantPortalSignature({
    secret,
    timestamp,
    eventId: 'evt-1',
    method: 'POST',
    pathname,
    body,
  });
}

describe('valorant portal HMAC verification', () => {
  const pathname = `${VALORANT_PORTAL_API_PREFIX}/stats`;
  const body = JSON.stringify({ actorDiscordUserId: ACTOR_ID });

  it('accepts a correctly signed request', () => {
    const timestamp = String(NOW);
    expect(
      verifyValorantPortalRequest({
        secret: SECRET,
        method: 'POST',
        pathname,
        body,
        headers: {
          timestamp,
          eventId: 'evt-1',
          signature: sign(SECRET, timestamp, body, pathname),
        },
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it('rejects a request without signature headers', () => {
    expect(
      verifyValorantPortalRequest({
        secret: SECRET,
        method: 'POST',
        pathname,
        body,
        headers: { timestamp: undefined, eventId: undefined, signature: undefined },
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const timestamp = String(NOW);
    expect(
      verifyValorantPortalRequest({
        secret: SECRET,
        method: 'POST',
        pathname,
        body: `${body} `,
        headers: {
          timestamp,
          eventId: 'evt-1',
          signature: sign(SECRET, timestamp, body, pathname),
        },
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('rejects an expired timestamp', () => {
    const timestamp = String(NOW - 6 * 60 * 1_000);
    expect(
      verifyValorantPortalRequest({
        secret: SECRET,
        method: 'POST',
        pathname,
        body,
        headers: {
          timestamp,
          eventId: 'evt-1',
          signature: sign(SECRET, timestamp, body, pathname),
        },
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const timestamp = String(NOW);
    expect(
      verifyValorantPortalRequest({
        secret: SECRET,
        method: 'POST',
        pathname,
        body,
        headers: {
          timestamp,
          eventId: 'evt-1',
          signature: sign('another-secret-value-9876543210', timestamp, body, pathname),
        },
        nowMs: NOW,
      }),
    ).toBe(false);
  });
});

describe('valorant portal api config', () => {
  it('is disabled by default and only enabled by an explicit true', () => {
    expect(loadValorantPortalApiConfig({}).enabled).toBe(false);
    expect(loadValorantPortalApiConfig({ VALORANT_PORTAL_API_ENABLED: 'false' }).enabled).toBe(
      false,
    );
    expect(loadValorantPortalApiConfig({ VALORANT_PORTAL_API_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('reads the S6 secret and the fixed guild id from env names only', () => {
    const config = loadValorantPortalApiConfig({
      VALORANT_PORTAL_API_ENABLED: 'true',
      HERTA_PORTAL_API_SECRET: SECRET,
      IVRM_INTEGRATION_GUILD_ID: GUILD_ID,
    });
    expect(config.secret).toBe(SECRET);
    expect(config.guildId).toBe(GUILD_ID);
    expect(loadValorantPortalApiConfig({ IVRM_INTEGRATION_GUILD_ID: 'not-a-guild' }).guildId).toBe(
      null,
    );
  });
});

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

function sessionRow(overrides: Partial<ValorantPortalSessionRow> = {}): ValorantPortalSessionRow {
  const base: ValorantPortalSessionRow = {
    id: 'session-1',
    guildId: GUILD_ID,
    channelId: '456789012345678901',
    messageId: '567890123456789012',
    creatorId: OTHER_ID,
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
  };
  return { ...base, ...overrides };
}

function participant(
  sessionId: string,
  userId: string,
): { sessionId: string; userId: string; joinedAt: Date } {
  return { sessionId, userId, joinedAt: new Date('2026-11-28T01:05:00.000Z') };
}

interface FakeWhere {
  guildId?: string;
  status?: string;
  mode?: { not: string } | string;
  OR?: { creatorId?: string; participants?: { some: { userId: string } } }[];
  participants?: { some: { userId: string } };
  id?: string;
}

function matchesWhere(row: ValorantPortalSessionRow, where: FakeWhere): boolean {
  if (where.guildId && row.guildId !== where.guildId) return false;
  if (where.id && row.id !== where.id) return false;
  if (where.status && row.status !== where.status) return false;
  if (where.mode) {
    if (typeof where.mode === 'string') {
      if (row.mode !== where.mode) return false;
    } else if (row.mode === where.mode.not) return false;
  }
  if (
    where.participants &&
    !row.participants.some((p) => p.userId === where.participants!.some.userId)
  ) {
    return false;
  }
  if (where.OR) {
    const hit = where.OR.some((clause) => {
      if (clause.creatorId) return row.creatorId === clause.creatorId;
      if (clause.participants) {
        return row.participants.some((p) => p.userId === clause.participants!.some.userId);
      }
      return false;
    });
    if (!hit) return false;
  }
  return true;
}

function createDeps(
  rows: ValorantPortalSessionRow[],
  members: ReadonlyMap<string, ValorantPortalMemberInfo>,
): { deps: ValorantPortalDeps; wheres: FakeWhere[] } {
  const wheres: FakeWhere[] = [];
  const prisma: ValorantPortalPrisma = {
    valorantPickSession: {
      findMany: async (args: unknown) => {
        const { where, take } = args as { where: FakeWhere; take?: number };
        wheres.push(where);
        const matched = rows.filter((row) => matchesWhere(row, where));
        return typeof take === 'number' ? matched.slice(0, take) : matched;
      },
      findFirst: async (args: unknown) => {
        const { where } = args as { where: FakeWhere };
        wheres.push(where);
        return rows.find((row) => matchesWhere(row, where)) ?? null;
      },
    },
  };
  const deps: ValorantPortalDeps = {
    prisma,
    guildId: GUILD_ID,
    guild: {
      getMember: async (userId) => members.get(userId) ?? null,
      listPostableTextChannels: async () => [{ id: '456789012345678901', name: 'valorant' }],
      listVoiceChannels: async () => [{ id: '678901234567890123', name: 'VC 1' }],
      resolveDisplayNames: async (userIds) =>
        new Map(
          userIds.filter((id) => members.has(id)).map((id) => [id, `表示名-${id.slice(0, 3)}`]),
        ),
    },
  };
  return { deps, wheres };
}

const actorMember: ValorantPortalMemberInfo = {
  userId: ACTOR_ID,
  displayName: 'アクター',
  isAdmin: false,
};
const adminMember: ValorantPortalMemberInfo = {
  userId: ACTOR_ID,
  displayName: '管理者',
  isAdmin: true,
};

describe('valorant portal api authorization', () => {
  it('rejects an actor who is not a guild member', async () => {
    const { deps } = createDeps([], new Map());
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/channels`,
      { actorDiscordUserId: ACTOR_ID },
    );
    expect(response.httpStatus).toBe(403);
    expect(response.payload).toEqual({ status: 'error', error: 'actor_not_in_guild' });
  });

  it('rejects a malformed actor id', async () => {
    const { deps } = createDeps([], new Map([[ACTOR_ID, actorMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/channels`,
      { actorDiscordUserId: 'not-an-id' },
    );
    expect(response.httpStatus).toBe(400);
    expect(response.payload).toEqual({ status: 'error', error: 'invalid_request' });
  });

  it('derives isAdmin on the Herta side and never trusts a claimed flag', async () => {
    const open = sessionRow({ participants: [participant('session-1', OTHER_ID)] });
    const { deps } = createDeps([open], new Map([[ACTOR_ID, actorMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/sessions/get`,
      { actorDiscordUserId: ACTOR_ID, sessionId: 'session-1', isAdmin: true },
    );
    expect(response.httpStatus).toBe(200);
    const session = response.payload['session'] as { permissions: Record<string, boolean> };
    expect(session.permissions['isAdmin']).toBe(false);
    expect(session.permissions['canDraw']).toBe(false);
  });

  it('grants draw hints to a guild admin even when not the creator', async () => {
    const open = sessionRow({ participants: [participant('session-1', OTHER_ID)] });
    const { deps } = createDeps([open], new Map([[ACTOR_ID, adminMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/sessions/get`,
      { actorDiscordUserId: ACTOR_ID, sessionId: 'session-1' },
    );
    const session = response.payload['session'] as { permissions: Record<string, boolean> };
    expect(session.permissions['isAdmin']).toBe(true);
    expect(session.permissions['canDraw']).toBe(true);
    expect(session.permissions['canJoin']).toBe(true);
  });
});

describe('valorant portal api read endpoints', () => {
  it('returns channel candidates', async () => {
    const { deps } = createDeps([], new Map([[ACTOR_ID, actorMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/channels`,
      { actorDiscordUserId: ACTOR_ID },
    );
    expect(response.httpStatus).toBe(200);
    expect(response.payload).toMatchObject({
      status: 'ok',
      textChannels: [{ id: '456789012345678901', name: 'valorant' }],
      voiceChannels: [{ id: '678901234567890123', name: 'VC 1' }],
    });
  });

  it('lists open sessions for the whole guild plus actor-related ones without duplicates', async () => {
    const open = sessionRow({
      id: 'open-1',
      participants: [participant('open-1', ACTOR_ID)],
    });
    const done = sessionRow({
      id: 'done-1',
      status: 'COMPLETED',
      creatorId: ACTOR_ID,
      completedAt: new Date('2026-11-27T01:00:00.000Z'),
    });
    const wolf = sessionRow({ id: 'wolf-1', mode: 'WEREWOLF', creatorId: ACTOR_ID });
    const { deps } = createDeps([open, done, wolf], new Map([[ACTOR_ID, actorMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/sessions/list`,
      { actorDiscordUserId: ACTOR_ID },
    );
    expect(response.httpStatus).toBe(200);
    const openSessions = response.payload['openSessions'] as { id: string }[];
    const actorSessions = response.payload['actorSessions'] as { id: string }[];
    expect(openSessions.map((s) => s.id)).toEqual(['open-1']);
    expect(actorSessions.map((s) => s.id)).toEqual(['done-1']);
  });

  it('hides werewolf sessions from the detail endpoint', async () => {
    const wolf = sessionRow({ id: 'wolf-1', mode: 'WEREWOLF' });
    const { deps } = createDeps([wolf], new Map([[ACTOR_ID, actorMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/sessions/get`,
      { actorDiscordUserId: ACTOR_ID, sessionId: 'wolf-1' },
    );
    expect(response.httpStatus).toBe(404);
    expect(response.payload).toEqual({ status: 'error', error: 'not_found' });
  });

  it('returns aggregated stats with the Studio read conditions and excludes werewolf draws', async () => {
    const draw = sessionRow({
      id: 'draw-1',
      status: 'COMPLETED',
      completedAt: new Date('2026-10-30T00:00:00.000Z'),
      candidates: [
        { agentId: 'jett', agentName: 'Jett' },
        { agentId: 'omen', agentName: 'Omen' },
      ],
      result: [{ userId: ACTOR_ID, agentId: 'jett', displayName: 'jett' }],
    });
    const wolfDraw = sessionRow({
      id: 'wolf-draw',
      status: 'COMPLETED',
      mode: 'WEREWOLF',
      completedAt: new Date('2026-10-30T00:00:00.000Z'),
      result: [{ userId: ACTOR_ID, agentId: 'jett', displayName: 'jett' }],
    });
    const { deps, wheres } = createDeps([draw, wolfDraw], new Map([[ACTOR_ID, actorMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/stats`,
      {
        actorDiscordUserId: ACTOR_ID,
      },
    );
    expect(response.httpStatus).toBe(200);
    expect(wheres[0]).toMatchObject({ status: 'COMPLETED', mode: { not: 'WEREWOLF' } });
    const stats = response.payload['stats'] as {
      totalDraws: number;
      truncated: boolean;
      retentionDays: number;
      agents: { agentId: string; selected: number; eligibleSessions: number }[];
    };
    expect(stats.totalDraws).toBe(1);
    expect(stats.truncated).toBe(false);
    expect(stats.retentionDays).toBe(90);
    expect(stats.agents.find((a) => a.agentId === 'jett')).toMatchObject({
      selected: 1,
      eligibleSessions: 1,
    });
  });

  it('returns only the actor history, newest first, with the limit clamped', async () => {
    const mine = sessionRow({
      id: 'mine-1',
      status: 'COMPLETED',
      completedAt: new Date('2026-11-27T01:00:00.000Z'),
      participants: [participant('mine-1', ACTOR_ID)],
    });
    const theirs = sessionRow({
      id: 'theirs-1',
      status: 'COMPLETED',
      completedAt: new Date('2026-11-27T02:00:00.000Z'),
      participants: [participant('theirs-1', OTHER_ID)],
    });
    const { deps } = createDeps([mine, theirs], new Map([[ACTOR_ID, actorMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/history`,
      { actorDiscordUserId: ACTOR_ID, limit: 999 },
    );
    expect(response.httpStatus).toBe(200);
    const sessions = response.payload['sessions'] as { id: string }[];
    expect(sessions.map((s) => s.id)).toEqual(['mine-1']);
  });

  it('returns not_found for unknown routes', async () => {
    const { deps } = createDeps([], new Map([[ACTOR_ID, actorMember]]));
    const response = await handleValorantPortalRequest(
      deps,
      `${VALORANT_PORTAL_API_PREFIX}/sessions/draw`,
      { actorDiscordUserId: ACTOR_ID },
    );
    expect(response.httpStatus).toBe(404);
  });
});
