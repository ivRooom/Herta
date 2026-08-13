import { describe, expect, it } from 'vitest';
import { resolveXpRewardRoleTargets } from './xp-reward-roles.js';
import type { XpLevelConfig } from './xp-level.js';

function config(overrides: Partial<XpLevelConfig> = {}): XpLevelConfig {
  return {
    enabled: true,
    xpPerMessage: 10,
    cooldownSeconds: 60,
    excludedChannelIds: [],
    excludedRoleIds: [],
    levelUpNotification: true,
    levelUpChannelId: null,
    leaderboardSize: 10,
    reward1Level: 5,
    reward1RoleId: '10001',
    reward2Level: 10,
    reward2RoleId: '10002',
    reward3Level: 20,
    reward3RoleId: '10003',
    ...overrides,
  };
}

describe('resolveXpRewardRoleTargets', () => {
  it('現在Levelに応じて付与対象と剥奪対象を判定する', () => {
    expect(resolveXpRewardRoleTargets(config(), 12)).toEqual([
      { roleId: '10001', level: 5, shouldHave: true },
      { roleId: '10002', level: 10, shouldHave: true },
      { roleId: '10003', level: 20, shouldHave: false },
    ]);
  });

  it('同じRoleが複数枠に設定された場合は最小Levelを採用する', () => {
    expect(
      resolveXpRewardRoleTargets(
        config({ reward2RoleId: '10001', reward2Level: 3, reward3RoleId: null }),
        4,
      ),
    ).toEqual([{ roleId: '10001', level: 3, shouldHave: true }]);
  });

  it('未設定Roleは再同期対象に含めない', () => {
    expect(
      resolveXpRewardRoleTargets(
        config({ reward1RoleId: null, reward2RoleId: null, reward3RoleId: null }),
        999,
      ),
    ).toEqual([]);
  });
});
