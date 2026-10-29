import { it, expect, vi } from 'vitest';
import { Events, MessageFlags } from 'discord.js';
import { HertaBot } from './bot.js';
import type { Logger } from '@herta/logger';

it('acknowledges a real Valorant dispatcher invocation before cold runtime lookup and handles lookup failure privately', async () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
  const bot = new HertaBot(logger);
  const internals = bot as unknown as {
    client: {
      listeners(event: string): ((interaction: unknown) => Promise<void>)[];
      destroy(): Promise<void>;
    };
    pluginLoader: {
      getGuildEvents: ReturnType<typeof vi.fn>;
      getGuildCommands: ReturnType<typeof vi.fn>;
    };
  };
  const deferReply = vi.fn();
  const followUp = vi.fn();
  internals.pluginLoader.getGuildEvents = vi.fn(async () => {
    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    throw new Error('synthetic unavailable');
  });
  internals.pluginLoader.getGuildCommands = vi.fn(async () => {
    throw new Error('synthetic unavailable');
  });
  const interaction = {
    isChatInputCommand: () => true,
    isButton: () => false,
    isRepliable: () => true,
    commandName: 'valorant',
    guildId: 'synthetic-guild',
    user: { id: 'synthetic-user' },
    options: { getSubcommand: () => 'random' },
    deferReply,
    followUp,
    deferred: true,
    replied: false,
  };
  try {
    await internals.client.listeners(Events.InteractionCreate)[0]!(interaction);
    expect(deferReply).toHaveBeenCalledOnce();
    expect(followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  } finally {
    await internals.client.destroy();
  }
});
