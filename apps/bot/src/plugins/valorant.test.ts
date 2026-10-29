import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { listValorantAgents } from '@herta/db';
import { VALORANT_AGENTS } from '@herta/plugin-catalog';
import { normalizeValorantConfig, valorantPlugin } from './valorant.js';

vi.mock('@herta/db', () => ({ listValorantAgents: vi.fn() }));
beforeEach(() => {
  vi.mocked(listValorantAgents).mockResolvedValue(null);
});

function fixture({
  inVoice = true,
  participants = ['u1', 'u2'],
  bots = [] as string[],
  uncached = [] as string[],
  missing = [] as string[],
  enabled = true,
  dbEnabled = true,
  dbError = false,
  enabledAgents = ['Jett', 'Astra'],
  otherVoice = [] as string[],
} = {}) {
  const members = new Map(
    [...participants, ...bots, ...otherVoice].map((id) => [
      id,
      { id, user: { bot: bots.includes(id) } },
    ]),
  );
  const channel: { id: string; name: string; guild?: unknown } = { id: 'vc1', name: 'ゲームVC' };
  const fetch = vi.fn(async (input: string | { user: string }) => {
    const id = typeof input === 'string' ? input : input.user;
    if (missing.includes(id)) throw new Error('Discord unavailable');
    if (id === 'u1')
      return { id, user: { bot: false }, voice: { channel: inVoice ? channel : null } };
    return members.get(id)!;
  });
  const voiceStates = new Map(
    [...members.entries()].map(([id, member]) => [
      id,
      {
        id,
        channelId: otherVoice.includes(id) ? 'vc2' : 'vc1',
        member: uncached.includes(id) ? null : member,
      },
    ]),
  );
  const guild = { members: { fetch }, voiceStates: { cache: voiceStates } };
  channel.guild = guild;
  const reply = vi.fn();
  const editReply = vi.fn();
  const followUp = vi.fn();
  const deferReply = vi.fn();
  const interaction = {
    guildId: 'guild',
    guild,
    user: { id: 'u1' },
    options: { getSubcommand: () => 'random' },
    reply,
    editReply,
    followUp,
    deferReply,
  };
  const findUnique = vi.fn(async () => {
    if (dbError) throw new Error('DB unavailable');
    return { enabled: dbEnabled, config: { enabled, enabledAgents } };
  });
  const context = {
    config: { enabled, enabledAgents },
    prisma: { guildPlugin: { findUnique } },
    logger: {},
  } as unknown as Parameters<NonNullable<typeof valorantPlugin.provideCommands>>[0];
  return {
    reply,
    editReply,
    followUp,
    deferReply,
    fetch,
    findUnique,
    execute: async () => {
      const handlers = await valorantPlugin.provideCommands!(context);
      await handlers[0]!.execute(interaction as unknown as ChatInputCommandInteraction);
    },
  };
}

describe('Valorant random', () => {
  it('defaults only for absent selection; explicit empty and malformed lists fail closed', () => {
    expect(normalizeValorantConfig({}).enabledAgents).toEqual([...VALORANT_AGENTS]);
    expect(normalizeValorantConfig({ enabledAgents: [] }).enabledAgents).toEqual([]);
    expect(normalizeValorantConfig({ enabledAgents: ['bad'] }).enabledAgents).toEqual([]);
    expect(normalizeValorantConfig({ enabledAgents: ['Jett', 'Jett'] }).enabledAgents).toEqual([
      'Jett',
    ]);
  });
  it('acknowledges privately before IO then publishes all humans, excluding bots and other VC', async () => {
    const f = fixture({ bots: ['bot'], otherVoice: ['elsewhere'] });
    await f.execute();
    expect(f.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      f.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(f.editReply.mock.invocationCallOrder[0]).toBeLessThan(
      f.followUp.mock.invocationCallOrder[0]!,
    );
    const options = f.followUp.mock.calls[0]![0];
    expect(options.flags).toEqual([]);
    expect(options.allowedMentions).toEqual({ parse: [] });
    const text = options.embeds[0].data.description;
    expect(text).toContain('<@u1>');
    expect(text).toContain('<@u2>');
    expect(text).not.toContain('bot');
    expect(text).not.toContain('elsewhere');
    expect(text).toContain('Astra');
    expect(text).toContain('Jett');
  });
  it('fetches uncached members', async () => {
    const f = fixture({ uncached: ['u2'] });
    await f.execute();
    expect(f.fetch).toHaveBeenCalledWith('u2');
    expect(f.followUp).toHaveBeenCalledOnce();
  });
  it.each([
    { inVoice: false },
    { enabledAgents: ['Astra'] },
    { enabledAgents: [] },
    { uncached: ['u2'], missing: ['u2'] },
    { missing: ['u1'] },
    { participants: ['u2'] },
    { dbEnabled: false },
    { dbError: true },
  ])('fails privately without partial assignment: %j', async (options) => {
    const f = fixture(options);
    await f.execute();
    expect(f.followUp).not.toHaveBeenCalled();
    expect(f.editReply).toHaveBeenCalled();
  });
  it('does not fetch members when config is disabled', async () => {
    const f = fixture({ enabled: false });
    await f.execute();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
  });
  it('reads current DB candidates on every invocation and excludes disabled entries', async () => {
    const agent = (agentId: string, enabled: boolean) => ({
      agentId,
      enabled,
      displayName: agentId,
      agentName: agentId,
      guildId: 'guild',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(listValorantAgents)
      .mockResolvedValueOnce([
        agent('custom-a', true),
        agent('custom-b', true),
        agent('disabled', false),
      ])
      .mockResolvedValueOnce([]);
    const f = fixture();
    await f.execute();
    expect(f.followUp.mock.calls[0]![0].embeds[0].data.description).toContain('custom-a');
    f.followUp.mockClear();
    await f.execute();
    expect(f.followUp).not.toHaveBeenCalled();
    expect(f.editReply).toHaveBeenLastCalledWith(expect.stringContaining('ありません'));
  });
  it('returns private DB read errors', async () => {
    vi.mocked(listValorantAgents).mockRejectedValue(new Error('unavailable'));
    const f = fixture();
    await f.execute();
    expect(f.followUp).not.toHaveBeenCalled();
    expect(f.editReply).toHaveBeenLastCalledWith(expect.stringContaining('データベース'));
  });
  it('publishes the random slash subcommand', () =>
    expect(
      valorantPlugin.manifest.commands[0]?.subcommands?.some(
        (command) => command.name === 'random',
      ),
    ).toBe(true));
});
