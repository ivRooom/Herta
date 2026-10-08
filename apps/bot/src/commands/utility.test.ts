import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  coreUtilityCommands,
  decodeBase64,
  decodeUrlComponent,
  discordSnowflakeCreatedAt,
  encodeBase64,
  encodeUrlComponent,
  formatDiscordTimestamp,
  formatJsonResult,
  hashText,
  jsonValueType,
  minifyJsonText,
  parseColor,
  parseJson,
  parseTeamMembers,
  prettyJsonText,
  splitIntoTeams,
} from './utility.js';

function codeBlockBody(content: string | null): string {
  expect(content).not.toBeNull();
  const lines = content?.split('\n') ?? [];
  return lines.slice(1, -1).join('\n');
}

describe('Core Utility Commands', () => {
  it('10個のCommandを重複なく登録する', () => {
    const names = coreUtilityCommands.map((command) => command.definition.name);
    expect(names).toEqual([
      'teams',
      'uuid',
      'timestamp',
      'snowflake',
      'hash',
      'color',
      'base64',
      'url',
      'textstats',
      'json',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('json Commandは3つのsubcommandを定義する', () => {
    expect(
      coreUtilityCommands
        .find((command) => command.definition.name === 'json')
        ?.definition.subcommands?.map((item) => item.name),
    ).toEqual(['validate', 'pretty', 'minify']);
  });

  it('チーム分け入力をカンマ・読点・改行で分割する', () => {
    expect(parseTeamMembers('A, B、C\nD')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('チーム分けでメンバーを失わず人数差を1以内にする', () => {
    const source = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const teams = splitIntoTeams(source, 3);
    expect(teams.flat().sort()).toEqual([...source].sort());
    const sizes = teams.map((team) => team.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('Discord Snowflakeから作成日時を復元する', () => {
    const date = discordSnowflakeCreatedAt('175928847299117063');
    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe('2016-04-30T11:18:25.796Z');
    expect(discordSnowflakeCreatedAt('abc')).toBeNull();
    expect(discordSnowflakeCreatedAt('0')).toBeNull();
  });

  it('Discord timestamp記法を生成する', () => {
    expect(formatDiscordTimestamp(1_700_000_000, 'F')).toBe('<t:1700000000:F>');
    expect(formatDiscordTimestamp(1_700_000_000.9, 'R')).toBe('<t:1700000000:R>');
  });

  it('SHAハッシュを既知ベクトルどおり生成する', () => {
    expect(hashText('abc', 'sha256')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashText('abc', 'sha384')).toHaveLength(96);
    expect(hashText('abc', 'sha512')).toHaveLength(128);
  });

  it('必須OptionとDiscord入力境界を定義する', () => {
    const teams = coreUtilityCommands.find((command) => command.definition.name === 'teams');
    const timestamp = coreUtilityCommands.find(
      (command) => command.definition.name === 'timestamp',
    );
    const snowflake = coreUtilityCommands.find(
      (command) => command.definition.name === 'snowflake',
    );
    const hash = coreUtilityCommands.find((command) => command.definition.name === 'hash');

    expect(teams?.definition.options?.[0]).toMatchObject({
      name: 'members',
      type: 'string',
      required: true,
    });
    expect(teams?.definition.options?.[1]).toMatchObject({
      name: 'teams',
      type: 'integer',
      required: true,
      minValue: 2,
      maxValue: 10,
    });
    expect(timestamp?.definition.options?.[0]).toMatchObject({
      name: 'unix',
      type: 'integer',
      required: true,
    });
    expect(snowflake?.definition.options?.[0]).toMatchObject({
      name: 'id',
      type: 'string',
      required: true,
    });
    expect(hash?.definition.options?.[0]).toMatchObject({
      name: 'text',
      type: 'string',
      required: true,
    });
    expect(hash?.definition.options?.[1]).toMatchObject({
      name: 'algorithm',
      type: 'string',
    });
  });

  it('HEXとRGBを正規化する', () => {
    expect(parseColor('#7c6df2')).toEqual({
      hex: '#7C6DF2',
      rgb: { r: 124, g: 109, b: 242 },
      decimal: 8_154_610,
    });
    expect(parseColor('rgb(124, 109, 242)')?.hex).toBe('#7C6DF2');
    expect(parseColor('rgb(256,0,0)')).toBeNull();
    expect(parseColor('#xyzxyz')).toBeNull();
  });

  it('UTF-8テキストをBase64で往復できる', () => {
    const encoded = encodeBase64('Herta テスト');
    expect(decodeBase64(encoded)).toBe('Herta テスト');
    expect(decodeBase64('%%%')).toBeNull();
    expect(decodeBase64('////')).toBeNull();
  });

  it('URL componentを安全に往復し、不正escapeを拒否する', () => {
    const encoded = encodeUrlComponent('Herta 日本語 / test');
    expect(decodeUrlComponent(encoded)).toBe('Herta 日本語 / test');
    expect(decodeUrlComponent('%E0%A4%A')).toBeNull();
  });

  it('Unicode code point・行数・単語数・UTF-8 byte数を集計する', () => {
    expect(analyzeText('A😀 B\n日本語')).toEqual({
      characters: 9,
      codePoints: 8,
      lines: 2,
      words: 3,
      utf8Bytes: 17,
    });
  });

  it('color/base64/url/textstatsは必須Optionを定義する', () => {
    for (const name of ['color', 'base64', 'url', 'textstats']) {
      const command = coreUtilityCommands.find((candidate) => candidate.definition.name === name);
      expect(command?.definition.options?.some((option) => option.required)).toBe(true);
    }
  });

  it('object・array・primitive JSONを安全にparseする', () => {
    expect(parseJson('{"name":"Herta","enabled":true}')).toEqual({
      ok: true,
      value: { name: 'Herta', enabled: true },
    });
    expect(parseJson('[1,2,3]')).toEqual({ ok: true, value: [1, 2, 3] });
    expect(parseJson('null')).toEqual({ ok: true, value: null });
    expect(parseJson('"text"')).toEqual({ ok: true, value: 'text' });
  });

  it('不正JSONを拒否する', () => {
    expect(parseJson('{"name":"Herta",}')).toEqual({ ok: false });
    expect(parseJson('undefined')).toEqual({ ok: false });
  });

  it('トップレベル型をJSON向けに判定する', () => {
    expect(jsonValueType({})).toBe('object');
    expect(jsonValueType([])).toBe('array');
    expect(jsonValueType(null)).toBe('null');
    expect(jsonValueType('Herta')).toBe('string');
    expect(jsonValueType(1)).toBe('number');
    expect(jsonValueType(true)).toBe('boolean');
  });

  it('文字列内の空白を保持してpretty / minifyする', () => {
    const input = '{ "name": "Herta bot", "nested": { "enabled": true }, "items": [1, 2] }';
    expect(minifyJsonText(input)).toBe(
      '{"name":"Herta bot","nested":{"enabled":true},"items":[1,2]}',
    );
    expect(prettyJsonText(input)).toBe(
      '{\n  "name": "Herta bot",\n  "nested": {\n    "enabled": true\n  },\n  "items": [\n    1,\n    2\n  ]\n}',
    );
  });

  it('巨大整数・指数・高精度小数のlexemeを変更しない', () => {
    const input = '{"id":9007199254740993,"overflow":1e400,"fraction":0.12345678901234567890}';
    expect(minifyJsonText(input)).toBe(input);

    const pretty = prettyJsonText(input);
    expect(pretty).toContain('9007199254740993');
    expect(pretty).toContain('1e400');
    expect(pretty).toContain('0.12345678901234567890');
  });

  it('code fenceをJSON escapeへ変換して元の値を保持する', () => {
    const content = formatJsonResult('{"value":"```"}', false);
    const body = codeBlockBody(content);

    expect(body).toContain('\\u0060\\u0060\\u0060');
    expect(JSON.parse(body)).toEqual({ value: '```' });
  });

  it('整形後・escape後の長すぎる結果を拒否する', () => {
    expect(formatJsonResult(`{"value":"${'x'.repeat(2_000)}"}`, false)).toBeNull();
    expect(formatJsonResult(`{"value":"${'```'.repeat(300)}"}`, false)).toBeNull();
  });
});
