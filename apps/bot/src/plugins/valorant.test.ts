import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { normalizeValorantConfig, valorantPlugin } from './valorant.js';
import { valorantManifest } from '@herta/plugin-catalog';

function fixture(
  map: string | null = null,
  enabled = true,
  members: Array<{ id: string; bot?: boolean }> = [],
  maxParticipants = 5,
) {
  const create = vi.fn().mockResolvedValue({
    id: 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05',
    mode: map ? 'TACTICAL' : 'RANDOM',
    mapId: map,
    guildId: 'guild',
    channelId: 'channel',
    creatorId: 'owner',
    status: 'OPEN',
    maxParticipants: 5,
    participants: [],
    expiresAt: new Date(Date.now() + 10000),
    createdAt: new Date(),
    completedAt: null,
    result: null,
  });
  const memberSlots = Object.fromEntries(members.map((user, i) => [`member${i + 1}`, user]));
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockResolvedValue({ enabled, config: { enabled, maxParticipants } });
  const followUp = vi.fn().mockResolvedValue({ id: 'posted-message' });
  const editReply = vi.fn();
  const deferReply = vi.fn();
  const reply = vi.fn();
  const interaction = {
    guildId: 'guild',
    channelId: 'channel',
    user: { id: 'owner' },
    appPermissions: null,
    options: {
      getSubcommand: () => 'random',
      getString: () => map,
      getUser: (name: string) => memberSlots[name] ?? null,
      getMember: (name: string) => memberSlots[name] ? { user: memberSlots[name] } : null,
    },
    deferred: false,
    replied: false,
    deferReply,
    reply,
    editReply,
    followUp,
  };
  const context = {
    config: { enabled },
    prisma: {
      guildPlugin: { findUnique },
      valorantPickSession: { create, update },
      valorantRoster: { findUnique: vi.fn().mockResolvedValue(null) },
    },
    logger: { error: vi.fn(), warn: vi.fn() },
  } as unknown as Parameters<NonNullable<typeof valorantPlugin.provideCommands>>[0];
  return {
    create,
    update,
    findUnique,
    followUp,
    editReply,
    deferReply,
    reply,
    run: async () => {
      const commands = await valorantPlugin.provideCommands!(context);
      await commands[0]!.execute(interaction as unknown as ChatInputCommandInteraction);
    },
  };
}
describe('VALORANT button recruitment slash command', () => {
  it('preserves default legacy candidates and clamps session settings', () => {
    expect(normalizeValorantConfig({}).maxParticipants).toBe(5);
    expect(normalizeValorantConfig({ maxParticipants: 8 }).maxParticipants).toBe(5);
    expect(normalizeValorantConfig({ sessionDurationMinutes: 2 }).sessionDurationMinutes).toBe(5);
    expect(normalizeValorantConfig({ enabledAgents: [] }).enabledAgents).toEqual([]);
  });
  it('creates a DB-backed OPEN session without requiring a VC connection', async () => {
    const f = fixture();
    await f.run();
    expect(f.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ guildId: 'guild', mode: 'RANDOM', mapId: null }),
      }),
    );
    expect(f.followUp).toHaveBeenCalledOnce();
    expect(f.followUp.mock.calls[0]![0].components[0].components).toHaveLength(4);
    expect(f.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { messageId: 'posted-message' },
      }),
    );
  });
  it('uses tactical mode when a map is selected', async () => {
    const f = fixture('Ascent');
    await f.run();
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: 'TACTICAL', mapId: 'Ascent' }),
      }),
    );
  });
  it('registers 5 optional Discord user mention options', () => {
    const random = valorantManifest.commands[0]!.subcommands!.find(({ name }) => name === 'random');
    expect(random?.options?.filter(({ type }) => type === 'user')).toHaveLength(5);
  });
  it('commits @mentioned users directly and shows only the reroll button', async () => {
    const f = fixture(null, true, [{ id: 'alice' }, { id: 'bob' }]);
    // The mock should model the completed row returned by Prisma.
    f.create.mockImplementationOnce(async ({ data }: { data: Record<string, any> }) => ({
      ...data,
      id: 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05',
      participants: data.participants.create.map(({ userId }: { userId: string }) => ({ userId })),
      createdAt: new Date(),
      result: data.result,
    }));
    await f.run();
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          maxParticipants: 2,
          participants: { create: [{ userId: 'alice' }, { userId: 'bob' }] },
        }),
      }),
    );
    const components = f.followUp.mock.calls[0]![0].components[0].components;
    expect(components).toHaveLength(1);
    expect(components[0].data.label).toBe('再抽選');
    expect(f.editReply).toHaveBeenCalledWith(expect.stringContaining('抽選が完了'));
  });
  it('rejects duplicate @mentions without creating a session', async () => {
    const f = fixture(null, true, [{ id: 'alice' }, { id: 'alice' }]);
    await f.run();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editReply).toHaveBeenCalledWith(expect.stringContaining('重複'));
  });
  it('honors the Guild participant limit for direct draws', async () => {
    const f = fixture(null, true, [{ id: 'alice' }, { id: 'bob' }], 1);
    await f.run();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editReply).toHaveBeenCalledWith(expect.stringContaining('上限'));
  });
  it('rejects @mention of bot accounts', async () => {
    const f = fixture(null, true, [{ id: 'bot', bot: true }]);
    await f.run();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editReply).toHaveBeenCalledWith(expect.stringContaining('Bot'));
  });
  it('fails privately when the plugin is disabled', async () => {
    const f = fixture(null, false);
    await f.run();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.followUp).not.toHaveBeenCalled();
    expect(f.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('無効'),
        flags: MessageFlags.Ephemeral,
      }),
    );
  });
});
