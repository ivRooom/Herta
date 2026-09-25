import { describe, expect, it } from 'vitest';
import { MBTI_TYPE_KEYS, mbtiManifest, mbtiRoleConfigKey } from '@herta/plugin-catalog';
import { normalizeMbtiConfig } from './mbti.js';

function emptyMbtiRoles(): Record<string, string | null> {
  return Object.fromEntries(MBTI_TYPE_KEYS.map((type) => [type, null]));
}

describe('MBTI Plugin', () => {
  it('設定を安全な範囲へ正規化する', () => {
    expect(normalizeMbtiConfig(undefined)).toEqual({
      enabled: true,
      mbtiRoles: emptyMbtiRoles(),
    });
    expect(normalizeMbtiConfig({ enabled: false })).toEqual({
      enabled: false,
      mbtiRoles: emptyMbtiRoles(),
    });
  });

  it('MBTI Role IDを正規化し不正な値はnullへフォールバックする', () => {
    const normalized = normalizeMbtiConfig({
      [mbtiRoleConfigKey('INTJ')]: '123456789012345678',
      [mbtiRoleConfigKey('ENFP')]: 'not-a-discord-id',
    });
    expect(normalized.mbtiRoles.INTJ).toBe('123456789012345678');
    expect(normalized.mbtiRoles.ENFP).toBeNull();
    expect(normalized.mbtiRoles.ISTJ).toBeNull();
    expect(Object.keys(normalized.mbtiRoles).sort()).toEqual([...MBTI_TYPE_KEYS].sort());
  });

  it('Manifestに/mbtiコマンドを単独で登録する', () => {
    expect(mbtiManifest.commands.map((command) => command.name)).toEqual(['mbti']);
  });
});
