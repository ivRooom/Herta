import { describe, expect, it } from 'vitest';
import { questBoardManifest } from './quest-board.js';

describe('questBoardManifest', () => {
  it('registers the quest board as a catalog plugin (#946)', () => {
    expect(questBoardManifest.id).toBe('quest-board');
    expect(questBoardManifest.name).toBe('クエストボード');
    expect(questBoardManifest.permissions).toEqual([]);
    expect(questBoardManifest.dependencies).toEqual([]);
    expect(questBoardManifest.events).toEqual(['interactionCreate']);
  });

  it('exposes only the enabled switch to Studio', () => {
    const schema = questBoardManifest.configSchema as {
      additionalProperties: boolean;
      properties: Record<string, { type: string; title: string; default: unknown }>;
      required: string[];
    };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(['enabled']);
    expect(schema.required).toEqual(['enabled']);
    expect(schema.properties.enabled).toMatchObject({ type: 'boolean', default: true });
  });

  it('declares /quest with the three period subcommands and no options', () => {
    expect(questBoardManifest.commands).toHaveLength(1);
    const command = questBoardManifest.commands[0]!;
    expect(command.name).toBe('quest');
    expect(command.options).toBeUndefined();
    expect(command.subcommands?.map((subcommand) => subcommand.name)).toEqual([
      'daily',
      'weekly',
      'monthly',
    ]);
    for (const subcommand of command.subcommands ?? []) {
      expect(subcommand.options).toBeUndefined();
    }
  });
});
