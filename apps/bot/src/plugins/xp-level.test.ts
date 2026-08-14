import { describe, expect, it } from 'vitest';
import { xpLevelManifest } from '@herta/plugin-catalog';
import {
  formatLeaderboard,
  formatRankMessage,
  levelForXp,
  normalizeXpLevelConfig,
  shouldAwardXpByActivityRules,
  xpRequiredForLevel,
} from './xp-level.js';
import type { XpProfileRecord } from './xp-level-repository.js';

describe('XP / Level v1', () => {
  it('Studio設定を安全な範囲へ正規化する', () => {
    expect(normalizeXpLevelConfig(undefined)).toEqual({
      enabled: true,
      xpPerMessage: 10,
      cooldownSeconds: 60,
      excludedChannelIds: [],
      excludedRoleIds: [],
      levelUpNotification: true,
      levelUpChannelId: null,
      leaderboardSize: 10,
      reward1Level: 5,
      reward1RoleId: null,
      reward2Level: 10,
      reward2RoleId: null,
      reward3Level: 20,
      reward3RoleId: null,
    });

    expect(
      normalizeXpLevelConfig({
        xpPerMessage: 999,
        cooldownSeconds: 0,
        leaderboardSize: 100,
        excludedChannelIds: ['123', '123', 'bad'],
        excludedRoleIds: ['456', 'bad'],
        reward1Level: 0,
        reward1RoleId: '789',
      }),
    ).toMatchObject({
      xpPerMessage: 100,
      cooldownSeconds: 5,
      leaderboardSize: 25,
      excludedChannelIds: ['123'],
      excludedRoleIds: ['456'],
      reward1Level: 1,
      reward1RoleId: '789',
    });
  });

  it('Activity Rules未導入またはXP連携OFFなら従来どおりXP対象にする', () => {
    const candidate = {
      channelId: '100',
      roleIds: ['200'],
      contentAvailable: true,
      content: '!help',
      contentLength: 5,
    };
    expect(shouldAwardXpByActivityRules(null, candidate)).toBe(true);
    expect(
      shouldAwardXpByActivityRules(
        {
          applyMessageRulesToXp: false,
          excludedTextChannelIds: ['100'],
          excludedRoleIds: ['200'],
          excludeCommandMessages: true,
          commandPrefixes: ['!'],
        },
        candidate,
      ),
    ).toBe(true);
  });

  it('Activity Rulesの発言除外をXPへ適用できる', () => {
    const config = {
      applyMessageRulesToXp: true,
      excludedTextChannelIds: ['100'],
      excludedRoleIds: ['200'],
      excludeCommandMessages: true,
      commandPrefixes: ['!'],
      minimumMessageLength: 5,
    };

    expect(
      shouldAwardXpByActivityRules(config, {
        channelId: '100',
        roleIds: [],
        contentAvailable: true,
        content: 'hello',
        contentLength: 5,
      }),
    ).toBe(false);
    expect(
      shouldAwardXpByActivityRules(config, {
        channelId: '101',
        roleIds: ['200'],
        contentAvailable: true,
        content: 'hello',
        contentLength: 5,
      }),
    ).toBe(false);
    expect(
      shouldAwardXpByActivityRules(config, {
        channelId: '101',
        roleIds: [],
        contentAvailable: true,
        content: '   !help',
        contentLength: 8,
      }),
    ).toBe(false);
    expect(
      shouldAwardXpByActivityRules(config, {
        channelId: '101',
        roleIds: [],
        contentAvailable: true,
        content: 'abcd',
        contentLength: 4,
      }),
    ).toBe(false);
  });

  it('Message Content Intentが無い場合はActivity Rulesの本文条件だけをXPでスキップする', () => {
    expect(
      shouldAwardXpByActivityRules(
        {
          applyMessageRulesToXp: true,
          excludeCommandMessages: true,
          commandPrefixes: ['!'],
          minimumMessageLength: 50,
        },
        {
          channelId: '101',
          roleIds: [],
          contentAvailable: false,
          content: '!help',
          contentLength: 0,
        },
      ),
    ).toBe(true);
  });

  it('XPから二次曲線ベースのLevelを算出する', () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(99)).toBe(0);
    expect(levelForXp(100)).toBe(1);
    expect(levelForXp(399)).toBe(1);
    expect(levelForXp(400)).toBe(2);
    expect(levelForXp(900)).toBe(3);
    expect(xpRequiredForLevel(10)).toBe(10_000);
  });

  it('Rank表示にLevel・XP・進捗・順位を含める', () => {
    const profile: XpProfileRecord = {
      guildId: 'guild',
      userId: '123',
      xp: 450,
      lastXpAt: new Date('2026-08-11T00:00:00Z'),
    };
    const message = formatRankMessage(profile, 3, '123');
    expect(message).toContain('Level: **2**');
    expect(message).toContain('XP: **450**');
    expect(message).toContain('50 / 500 XP');
    expect(message).toContain('#3');
  });

  it('LeaderboardをXP順の表示へ整形する', () => {
    const records: XpProfileRecord[] = [
      { guildId: 'g', userId: '1', xp: 1000, lastXpAt: null },
      { guildId: 'g', userId: '2', xp: 400, lastXpAt: null },
    ];
    const message = formatLeaderboard(records);
    expect(message).toContain('1. <@1> — Lv.3 / 1,000 XP');
    expect(message).toContain('2. <@2> — Lv.2 / 400 XP');
  });

  it('RankとLeaderboardが8種類のCommunity指標を公開する', () => {
    const expectedMetrics = [
      'xp',
      'level',
      'messages',
      'reactions',
      'voice',
      'minecraft',
      'achievements',
      'season',
    ];
    for (const commandName of ['rank', 'leaderboard']) {
      const command = xpLevelManifest.commands.find((item) => item.name === commandName);
      const metric = command?.options?.find((option) => option.name === 'metric');
      const period = command?.options?.find((option) => option.name === 'period');
      expect(metric?.choices?.map((choice) => choice.value)).toEqual(expectedMetrics);
      expect(period?.choices?.map((choice) => choice.value)).toEqual([
        'all',
        '7d',
        '30d',
        'season',
      ]);
    }

    const leaderboard = xpLevelManifest.commands.find((item) => item.name === 'leaderboard');
    const limit = leaderboard?.options?.find((option) => option.name === 'limit');
    expect(limit).toMatchObject({ type: 'integer', minValue: 5, maxValue: 25 });
  });
});
