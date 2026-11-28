import { createServer } from 'node:http';
import { createLogger } from '@herta/logger';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeValorantPortalSignature,
  VALORANT_PORTAL_API_PREFIX,
  type ValorantPortalDeps,
} from './valorant-portal-api.js';
import { startValorantPortalApiServer, ValorantPortalApiServer } from './valorant-portal-server.js';

const logger = createLogger({ name: 'valorant-portal-test', level: 'silent' });
const SECRET = 'portal-server-test-secret-0123456789';
const ACTOR_ID = '234567890123456789';
const GUILD_ID = '123456789012345678';

const deps: ValorantPortalDeps = {
  guildId: GUILD_ID,
  prisma: {
    valorantPickSession: {
      findMany: async () => [],
      findFirst: async () => null,
    },
  },
  guild: {
    getMember: async (userId) =>
      userId === ACTOR_ID ? { userId, displayName: 'アクター', isAdmin: false } : null,
    listPostableTextChannels: async () => [{ id: '456789012345678901', name: 'valorant' }],
    listVoiceChannels: async () => [],
    resolveDisplayNames: async () => new Map(),
  },
};

const servers: ValorantPortalApiServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function startTestServer(): Promise<string> {
  const server = new ValorantPortalApiServer({
    config: { host: '127.0.0.1', port: 0 },
    secret: SECRET,
    logger,
    deps,
  });
  servers.push(server);
  await server.start();
  const address = server.getAddress();
  if (!address) throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

function signedHeaders(
  pathname: string,
  body: string,
  options: { secret?: string; timestamp?: string } = {},
): Record<string, string> {
  const timestamp = options.timestamp ?? String(Date.now());
  return {
    'Content-Type': 'application/json',
    'X-IVRM-Timestamp': timestamp,
    'X-IVRM-Event-Id': 'evt-server-1',
    'X-IVRM-Signature': computeValorantPortalSignature({
      secret: options.secret ?? SECRET,
      timestamp,
      eventId: 'evt-server-1',
      method: 'POST',
      pathname,
      body,
    }),
  };
}

describe('valorant portal api server', () => {
  it('rejects requests without a signature', async () => {
    const base = await startTestServer();
    const pathname = `${VALORANT_PORTAL_API_PREFIX}/channels`;
    const response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorDiscordUserId: ACTOR_ID }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'error', error: 'unauthorized' });
  });

  it('rejects tampered and wrongly-signed requests', async () => {
    const base = await startTestServer();
    const pathname = `${VALORANT_PORTAL_API_PREFIX}/channels`;
    const body = JSON.stringify({ actorDiscordUserId: ACTOR_ID });

    const tampered = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: signedHeaders(pathname, body),
      body: JSON.stringify({ actorDiscordUserId: '345678901234567890' }),
    });
    expect(tampered.status).toBe(401);

    const wrongSecret = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: signedHeaders(pathname, body, { secret: 'wrong-secret-value-000000000000' }),
      body,
    });
    expect(wrongSecret.status).toBe(401);

    const expired = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: signedHeaders(pathname, body, {
        timestamp: String(Date.now() - 10 * 60 * 1_000),
      }),
      body,
    });
    expect(expired.status).toBe(401);
  });

  it('serves a signed read request', async () => {
    const base = await startTestServer();
    const pathname = `${VALORANT_PORTAL_API_PREFIX}/channels`;
    const body = JSON.stringify({ actorDiscordUserId: ACTOR_ID });
    const response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: signedHeaders(pathname, body),
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      textChannels: [{ id: '456789012345678901', name: 'valorant' }],
    });
  });

  it('rejects non-POST methods and unknown paths', async () => {
    const base = await startTestServer();
    const get = await fetch(`${base}${VALORANT_PORTAL_API_PREFIX}/channels`, { method: 'GET' });
    expect(get.status).toBe(405);
    const unknown = await fetch(`${base}/healthz`, { method: 'GET' });
    expect(unknown.status).toBe(404);
  });

  it('fails soft when the listen port is already taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('blocker did not bind');
    try {
      const server = await startValorantPortalApiServer({
        config: { host: '127.0.0.1', port: address.port },
        secret: SECRET,
        logger,
        deps,
      });
      expect(server).toBeNull();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
