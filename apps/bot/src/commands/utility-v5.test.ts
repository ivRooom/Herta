import { describe, expect, it } from 'vitest';
import { coreUtilityV5Commands, formatJsonResult, jsonValueType, parseJson } from './utility-v5.js';

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

  it('pretty / minifyをJSON code blockへ整形する', () => {
    const value = { name: 'Herta', nested: { enabled: true } };
    expect(formatJsonResult(value, true)).toContain(
      '{\n  "name": "Herta",\n  "nested": {\n    "enabled": true\n  }\n}',
    );
    expect(formatJsonResult(value, false)).toContain('{"name":"Herta","nested":{"enabled":true}}');
  });

  it('code fenceを無害化し、長すぎる結果を拒否する', () => {
    expect(formatJsonResult({ value: '```' }, false)).toContain('``\u200b`');
    expect(formatJsonResult({ value: 'x'.repeat(2_000) }, false)).toBeNull();
  });
});
