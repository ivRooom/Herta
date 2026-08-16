import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { communityActivityCommands } from './community-activity.js';
import { coreInformationCommands } from './core-info.js';
import { coreFunUtilityCommands } from './fun-utility.js';
import {
  CommandRegistry,
  PLUGIN_OWNED_COMMAND_NAMES,
  type SlashCommand,
} from './registry.js';
import { coreUtilityV3Commands } from './utility-v3.js';
import { coreUtilityV4Commands } from './utility-v4.js';

function createLogger(): Logger {
  return {
    warn: vi.fn(),
  } as unknown as Logger;
}

function expectedCoreCommandNames(): string[] {
  return [
    ...coreInformationCommands,
    ...coreFunUtilityCommands,
    ...coreUtilityV3Commands,
    ...coreUtilityV4Commands,
    ...communityActivityCommands,
  ]
    .map((command) => command.definition.name)
    .filter((name) => !PLUGIN_OWNED_COMMAND_NAMES.has(name));
}

describe('CommandRegistry command ownership audit', () => {
  it('Plugin非所有のCore Commandを漏れなくRegistryへ登録する', () => {
    const registry = new CommandRegistry(createLogger());
    const expected = [...expectedCoreCommandNames()].sort();
    const actual = registry
      .getAll()
      .map((command) => command.definition.name)
      .sort();

    expect(actual).toEqual(expected);
  });

  it('Core側の非Plugin所有Command名に重複がない', () => {
    const names = expectedCoreCommandNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('Utility v4コマンドをRegistryへ登録する', () => {
    const registry = new CommandRegistry(createLogger());
    for (const name of ['color', 'base64', 'url', 'textstats']) {
      expect(registry.get(name), `${name} should be registered`).toBeDefined();
    }
  });

  it('Mini Gamesが所有するcoinflipとdiceをCore登録から除外する', () => {
    const registry = new CommandRegistry(createLogger());

    expect(registry.get('coinflip')).toBeUndefined();
    expect(registry.get('dice')).toBeUndefined();
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
