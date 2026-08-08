import { describe, expect, it } from 'vitest';
import { isAllowedMemberSearchQuery } from './guild-members.js';

describe('Guild member search query', () => {
  it('2文字以上の名前検索を許可する', () => {
    expect(isAllowedMemberSearchQuery('iv')).toBe(true);
    expect(isAllowedMemberSearchQuery('  Herta  ')).toBe(true);
  });

  it('1文字だけの名前検索は拒否する', () => {
    expect(isAllowedMemberSearchQuery('a')).toBe(false);
    expect(isAllowedMemberSearchQuery(' ')).toBe(false);
  });

  it('Discord Snowflake IDは直接検索を許可する', () => {
    expect(isAllowedMemberSearchQuery('688313716055343104')).toBe(true);
  });

  it('短い数値は全件に近い検索を避けるため拒否する', () => {
    expect(isAllowedMemberSearchQuery('1234')).toBe(true);
    expect(isAllowedMemberSearchQuery('1')).toBe(false);
  });
});
