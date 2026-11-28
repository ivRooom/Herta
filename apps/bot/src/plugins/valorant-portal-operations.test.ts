import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@herta/db';
import type { Logger } from 'pino';
import { createValorantPortalOperations } from './valorant-portal-operations.js';
import type { ValorantPortalDiscordPort } from './valorant.js';
import type { ValorantSessionSnapshot } from './valorant-session-repository.js';

const GUILD_ID = '123456789012345678';
const ACTOR = { userId: '234567890123456789', displayName: 'アクター', isAdmin: false };

interface FakeState {
  deleted: boolean;
  savedMessageId: string | null;
  session: Record<string, unknown>;
}

function createFakePrisma(state: FakeState, pluginEnabled = true): PrismaClient {
  const prisma = {
    guildPlugin: {
      findUnique: async () => (pluginEnabled ? { enabled: true, config: { enabled: true } } : null),
    },
    valorantPickSession: {
      create: async (args: { data: Record<string, unknown> }) => {
        state.session = {
          id: 'created-1',
          guildId: GUILD_ID,
          messageId: null,
          status: 'OPEN',
          completedAt: null,
          candidates: [],
          result: null,
          participants: [],
          ...args.data,
        };
        return state.session;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        state.savedMessageId = args.data['messageId'] as string;
        state.session = { ...state.session, ...args.data };
        return state.session;
      },
      delete: async () => {
        state.deleted = true;
        return {};
      },
      findFirst: async () => state.session,
    },
  };
  return prisma as unknown as PrismaClient;
}

function createDiscordFake(failPost = false): {
  discord: ValorantPortalDiscordPort;
  synced: ValorantSessionSnapshot[];
} {
  const synced: ValorantSessionSnapshot[] = [];
  return {
    synced,
    discord: {
      postRecruitmentMessage: async () => {
        if (failPost) throw new Error('discord unavailable');
        return 'posted-message-1';
      },
      syncRecruitment: async (session) => {
        synced.push(session);
        return true;
      },
      publishDrawResult: async () => true,
    },
  };
}

const logger = { warn: () => undefined } as unknown as Logger;

describe('valorant portal operations create (S6-H2, §3.6)', () => {
  it('posts the recruitment embed, saves messageId, then responds', async () => {
    const state: FakeState = { deleted: false, savedMessageId: null, session: {} };
    const { discord } = createDiscordFake();
    const operations = createValorantPortalOperations({
      prisma: createFakePrisma(state),
      guildId: GUILD_ID,
      discord,
      logger,
    });
    const outcome = await operations.createSession(ACTOR, {
      mode: 'RANDOM',
      mapId: 'Ascent',
      channelId: '567890123456789012',
      voiceChannelId: '678901234567890123',
      vcAutoJoin: true,
      trollOff: true,
    });
    expect(outcome.status).toBe('ok');
    expect(state.savedMessageId).toBe('posted-message-1');
    expect(outcome.session?.messageId).toBe('posted-message-1');
    expect(outcome.session?.trollOffUserIds).toEqual([ACTOR.userId]);
    expect(state.deleted).toBe(false);
  });

  it('does not leave a session row when the recruitment post fails', async () => {
    const state: FakeState = { deleted: false, savedMessageId: null, session: {} };
    const { discord } = createDiscordFake(true);
    const operations = createValorantPortalOperations({
      prisma: createFakePrisma(state),
      guildId: GUILD_ID,
      discord,
      logger,
    });
    const outcome = await operations.createSession(ACTOR, {
      mode: 'RANDOM',
      mapId: null,
      channelId: '567890123456789012',
      voiceChannelId: null,
      vcAutoJoin: false,
      trollOff: false,
    });
    expect(outcome.status).toBe('unavailable');
    expect(state.deleted).toBe(true);
    expect(state.savedMessageId).toBeNull();
  });

  it('refuses creation while the valorant plugin is disabled', async () => {
    const state: FakeState = { deleted: false, savedMessageId: null, session: {} };
    const { discord } = createDiscordFake();
    const operations = createValorantPortalOperations({
      prisma: createFakePrisma(state, false),
      guildId: GUILD_ID,
      discord,
      logger,
    });
    const outcome = await operations.createSession(ACTOR, {
      mode: 'RANDOM',
      mapId: null,
      channelId: '567890123456789012',
      voiceChannelId: null,
      vcAutoJoin: false,
      trollOff: false,
    });
    expect(outcome.status).toBe('unavailable');
    expect(state.session).toEqual({});
  });
});
