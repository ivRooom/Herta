import { describe, expect, it } from 'vitest';
import {
  coreUtilityV5Commands,
  formatJsonResult,
  jsonValueType,
  minifyJsonText,
  parseJson,
  prettyJsonText,
} from './utility-v5.js';

function codeBlockBody(content: string | null): string {
  expect(content).not.toBeNull();
  const lines = content?.split('\n') ?? [];
  return lines.slice(1, -1).join('\n');
}

describe('Core Utility v5', () => {
  it('json Commandと3つのsubcommandを定義する', () => {
    expect(coreUtilityV5Commands.map((command) => command.definition.name)).toEqual(['json']);
    expect(coreUtilityV5Commands[0]?.definition.subcommands?.map((item) => item.name)).toEqual([
      'validate',
      'pretty',
      'minify',
    ]);
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
