import { describe, expect, it } from 'vitest';
import type { SlashCommand } from './registry.js';
import {
  buildHelpCommandDetail,
  buildHelpOverviewFields,
  findHelpSuggestions,
  helpV2Command,
  normalizeHelpCommandName,
} from './help-v2.js';

function command(
  name: string,
  description = `${name} description`,
  options?: SlashCommand['definition']['options'],
): SlashCommand {
  return {
    definition: { name, description, options },
    async execute() {},
  };
}

describe('Help v2', () => {
  it('command optionを任意のstringとして定義する', () => {
    expect(helpV2Command.definition.name).toBe('help');
    expect(helpV2Command.definition.options).toEqual([
      expect.objectContaining({ name: 'command', type: 'string' }),
    ]);
    expect(helpV2Command.definition.options?.[0]?.required).not.toBe(true);
  });

  it('Command名の先頭slashと大文字を正規化する', () => {
    expect(normalizeHelpCommandName(' /CoLoR ')).toBe('color');
    expect(normalizeHelpCommandName('activity-rank')).toBe('activity-rank');
    expect(normalizeHelpCommandName('bad command')).toBeNull();
    expect(normalizeHelpCommandName('/')).toBeNull();
  });

  it('一覧を名前順に並べ、重複名は最後の定義へ正規化する', () => {
    const fields = buildHelpOverviewFields([
      command('url', 'old'),
      command('color'),
      command('url', 'new'),
      command('base64'),
    ]);
    const output = fields.map((field) => field.value).join('\n');

    expect(output.indexOf('/base64')).toBeLessThan(output.indexOf('/color'));
    expect(output.indexOf('/color')).toBeLessThan(output.indexOf('/url'));
    expect(output).toContain('new');
    expect(output).not.toContain('old');
  });

  it('大量Commandでも各Embed fieldを1024文字以内に分割する', () => {
    const commands = Array.from({ length: 100 }, (_, index) =>
      command(`command-${String(index).padStart(3, '0')}`, 'x'.repeat(100)),
    );
    const fields = buildHelpOverviewFields(commands);

    expect(fields.length).toBeGreaterThan(1);
    expect(fields.every((field) => field.value.length <= 1_024)).toBe(true);
  });

  it('詳細Helpへ必須・任意optionを使い方付きで表示する', () => {
    const detail = buildHelpCommandDetail(
      command('sample', 'sample command', [
        { name: 'required', description: 'required option', type: 'string', required: true },
        { name: 'optional', description: 'optional option', type: 'integer' },
      ]),
    );

    expect(detail).toContain('/sample <required> [optional]');
    expect(detail).toContain('`required` (必須)');
    expect(detail).toContain('`optional` (任意)');
  });

  it('部分一致から最大件数まで候補を返す', () => {
    const commands = [command('activity'), command('activity-rank'), command('avatar'), command('color')];

    expect(findHelpSuggestions(commands, 'acti')).toEqual(['activity', 'activity-rank']);
    expect(findHelpSuggestions(commands, 'a', 2)).toHaveLength(2);
    expect(findHelpSuggestions(commands, 'bad command')).toEqual([]);
  });
});
