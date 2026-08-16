import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { CommandRegistry, type SlashCommand } from './registry.js';

function createLogger(): Logger {
  return {
    warn: vi.fn(),
  } as unknown as Logger;
}

describe('CommandRegistry plugin-owned commands', () => {
  it('Plugin非所有のCore Fun Utilityをすべて登録する', () => {
    const registry = new CommandRegistry(createLogger());

    for (const name of ['choose', 'random', '8ball', 'rps', 'shuffle', 'rate']) {
      expect(registry.get(name), `${name} should be registered`).toBeDefined();
    }
    expect(registry.get('hash')).toBeDefined();
  });

  it('Mini Gamesが所有するcoinflipとdiceをCore登録から除外する', () => {
    const registry = new CommandRegistry(createLogger());
    const names = registry.getAll().map((command) => command.definition.name);

    expect(registry.get('coinflip')).toBeUndefined();
    expect(registry.get('dice')).toBeUndefined();
    expect(new Set(names).size).toBe(names.length);
  });

  it('Plugin側からcoinflipとdiceを登録できる', () => {
    const registry = new CommandRegistry(createLogger());
    const commands: SlashCommand[] = ['coinflip', 'dice'].map((name) => ({
      definition: { name, description: `${name} plugin command` },
      async execute() {},
    }));

    registry.registerProvider({ provideCommands: () => commands });

    expect(registry.get('coinflip')?.definition.description).toBe('coinflip plugin command');
    expect(registry.get('dice')?.definition.description).toBe('dice plugin command');
  });
});
