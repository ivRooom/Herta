import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { CommandRegistry, type SlashCommand } from './registry.js';

function createLogger(): Logger {
  return {
    warn: vi.fn(),
  } as unknown as Logger;
}

describe('CommandRegistry plugin-owned commands', () => {
  it('Mini Gamesが所有するcoinflipとdiceをCore登録から除外する', () => {
    const registry = new CommandRegistry(createLogger());

    expect(registry.get('coinflip')).toBeUndefined();
    expect(registry.get('dice')).toBeUndefined();
    expect(registry.get('choose')).toBeDefined();
    expect(registry.get('random')).toBeDefined();
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
