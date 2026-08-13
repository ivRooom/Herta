import { describe, expect, it } from 'vitest';
import { shouldSweepMember } from './xp-role-sweep.js';

function member(input: { id: string; bot?: boolean; roleIds?: string[] }) {
  const roleIds = new Set(input.roleIds ?? []);
  return {
    id: input.id,
    user: { bot: input.bot ?? false },
    roles: { cache: { has: (roleId: string) => roleIds.has(roleId) } },
  } as never;
}

describe('shouldSweepMember', () => {
  it('XPを持つメンバーはRole未所持でも対象にする', () => {
    expect(
      shouldSweepMember(member({ id: '10001' }), new Map([['10001', 900]]), new Set(['20001'])),
    ).toBe(true);
  });

  it('XPが0でも設定済み報酬Roleを持つメンバーは剥奪確認の対象にする', () => {
    expect(
      shouldSweepMember(member({ id: '10001', roleIds: ['20001'] }), new Map(), new Set(['20001'])),
    ).toBe(true);
  });

  it('XPも報酬Roleもないメンバーは対象外にする', () => {
    expect(shouldSweepMember(member({ id: '10001' }), new Map(), new Set(['20001']))).toBe(false);
  });

  it('XP0のプロフィールだけ存在していても報酬Roleがなければ対象外にする', () => {
    expect(
      shouldSweepMember(member({ id: '10001' }), new Map([['10001', 0]]), new Set(['20001'])),
    ).toBe(false);
  });

  it('Botアカウントは対象外にする', () => {
    expect(
      shouldSweepMember(
        member({ id: '10001', bot: true, roleIds: ['20001'] }),
        new Map([['10001', 900]]),
        new Set(['20001']),
      ),
    ).toBe(false);
  });
});
