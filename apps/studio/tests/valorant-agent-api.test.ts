import { beforeEach, describe, expect, it, vi } from 'vitest';
import { valorantAgentRequest } from '../src/lib/valorant-agent-api';
import { auth } from '@/auth';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasEffectivePluginConfigPermission } from '@/lib/studio-plugin-permissions';
import { listValorantAgents, mutateValorantAgent, ValorantAgentError } from '@herta/db';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    guildPlugin: { findUnique: vi.fn(async () => ({ config: { enabledAgents: ['Jett'] } })) },
  },
}));
vi.mock('@/lib/studio-access', () => ({ resolveStudioAccess: vi.fn() }));
vi.mock('@/lib/studio-plugin-permissions', () => ({ hasEffectivePluginConfigPermission: vi.fn() }));
vi.mock('@herta/db', async (original) => ({
  ...(await original<object>()),
  listValorantAgents: vi.fn(),
  mutateValorantAgent: vi.fn(),
}));

const guild = '123456789012345678';
const other = '223456789012345678';
const agent = { agentId: 'custom', agentName: 'Custom', displayName: 'カスタム', enabled: true };
function request(method = 'GET', body?: unknown, origin = 'https://studio.example') {
  return new Request(`https://studio.example/api/guilds/${guild}/valorant/agents`, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: 'manager' } } as never);
  vi.mocked(resolveStudioAccess).mockResolvedValue({ ok: true, access: {} } as never);
  vi.mocked(hasEffectivePluginConfigPermission).mockReturnValue(true);
  vi.mocked(listValorantAgents).mockResolvedValue([]);
  vi.mocked(mutateValorantAgent).mockResolvedValue([]);
});

describe('guild Valorant CRUD authorization and validation', () => {
  it('requires a Discord session', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await valorantAgentRequest(request(), guild)).status).toBe(401);
    expect(resolveStudioAccess).not.toHaveBeenCalled();
  });
  it.each(['GET', 'POST', 'PATCH', 'DELETE'])(
    'rejects other guild / management permission failures for %s',
    async (method) => {
      vi.mocked(resolveStudioAccess).mockResolvedValue({
        ok: false,
        response: Response.json({}, { status: 403 }),
      });
      expect(
        (
          await valorantAgentRequest(
            request(method, method === 'POST' || method === 'PATCH' ? agent : undefined),
            other,
            method === 'PATCH' || method === 'DELETE' ? agent.agentId : undefined,
          )
        ).status,
      ).toBe(403);
      expect(listValorantAgents).not.toHaveBeenCalled();
      expect(mutateValorantAgent).not.toHaveBeenCalled();
    },
  );
  it('rejects IAM deny and cross-origin mutations', async () => {
    vi.mocked(hasEffectivePluginConfigPermission).mockReturnValue(false);
    expect((await valorantAgentRequest(request('POST', agent), guild)).status).toBe(403);
    expect(
      (await valorantAgentRequest(request('POST', agent, 'https://evil.example'), guild)).status,
    ).toBe(403);
    expect(mutateValorantAgent).not.toHaveBeenCalled();
  });
  it('validates IDs and bounded bodies before mutation', async () => {
    expect((await valorantAgentRequest(request(), 'bad')).status).toBe(400);
    expect(
      (await valorantAgentRequest(request('POST', { ...agent, agentId: '../bad' }), guild)).status,
    ).toBe(400);
    expect(
      (await valorantAgentRequest(request('POST', { ...agent, guildId: other }), guild)).status,
    ).toBe(400);
    expect(
      (
        await valorantAgentRequest(
          request('POST', { ...agent, displayName: 'x'.repeat(5000) }),
          guild,
        )
      ).status,
    ).toBe(413);
    expect((await valorantAgentRequest(request('PATCH', agent), guild, 'another')).status).toBe(
      400,
    );
  });
  it('returns current scoped list and honors intentionally empty roster', async () => {
    const result = await valorantAgentRequest(request(), guild);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ agents: [], initialized: true });
    expect(listValorantAgents).toHaveBeenCalledWith(expect.anything(), guild);
    expect(result.headers.get('cache-control')).toContain('no-store');
  });
  it('provides legacy defaults without writes before initialization', async () => {
    vi.mocked(listValorantAgents).mockResolvedValue(null);
    const result = await (await valorantAgentRequest(request(), guild)).json();
    expect(result.initialized).toBe(false);
    expect(result.agents.filter((row: typeof agent) => row.enabled)).toHaveLength(1);
    expect(mutateValorantAgent).not.toHaveBeenCalled();
  });
  it.each([
    ['POST', agent, undefined, 'create', 201],
    ['PATCH', { ...agent, enabled: false }, 'custom', 'update', 200],
    ['DELETE', undefined, 'custom', 'delete', 200],
    ['POST', { action: 'initialize' }, undefined, 'initialize', 200],
  ] as const)(
    'uses authenticated actor and route guild for %s',
    async (method, body, id, action, status) => {
      const result = await valorantAgentRequest(request(method, body), guild, id);
      expect(result.status).toBe(status);
      expect(mutateValorantAgent).toHaveBeenCalledWith(
        expect.anything(),
        guild,
        'manager',
        expect.objectContaining({ action }),
        expect.any(Array),
      );
    },
  );
  it.each([404, 409])('maps repository conflict/not-found %s', async (status) => {
    vi.mocked(mutateValorantAgent).mockRejectedValue(new ValorantAgentError(status, 'safe error'));
    expect((await valorantAgentRequest(request('POST', agent), guild)).status).toBe(status);
  });
  it('returns sanitized DB unavailability', async () => {
    vi.mocked(listValorantAgents).mockRejectedValue(new Error('private-connection-string'));
    const result = await valorantAgentRequest(request(), guild);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('private-connection-string');
  });
});
