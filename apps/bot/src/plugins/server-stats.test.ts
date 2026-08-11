import { describe, expect, it } from 'vitest';
import {
  formatPluginPages,
  formatServerActivity,
  formatServerStats,
  normalizeServerStatsConfig,
} from './server-stats.js';

const guild = {
  name: 'Herta Test',
  memberCount: 120,
  channels: { cache: { size: 18 } },
  roles: { cache: { size: 9 } },
  members: {
    cache: {
      size: 120,
      *values() {
        for (let index = 0; index < 120; index += 1) {
          yield { user: { bot: index < 5 } };
        }
      },
    },
  },
};

const metrics = {
  afkUsers: 3,
  openPolls: 2,
  openGiveaways: 1,
  openSuggestions: 4,
  pendingReminders: 7,
  enabledPlugins: 12,
  enabledRules: 0,
};

describe('Server Stats v1', () => {
  it('設定値を安全な既定値と範囲へ正規化する', () => {
    expect(normalizeServerStatsConfig(undefined)).toEqual({
      enabled: true,
      ephemeralResponses: false,
      adminOnly: false,
      includeBots: true,
      activityWindowDays: 7,
      showZeroMetrics: false,
      showCommunityMetrics: true,
      showContentMetrics: true,
      showPluginSummary: true,
    });
    expect(normalizeServerStatsConfig({ activityWindowDays: 999, adminOnly: true })).toMatchObject({
      activityWindowDays: 30,
      adminOnly: true,
    });
  });

  it('Guild構成とコミュニティ指標を表示する', () => {
    const output = formatServerStats(guild, metrics, normalizeServerStatsConfig(undefined));
    expect(output).toContain('メンバー: **120**');
    expect(output).toContain('チャンネル: **18**');
    expect(output).toContain('Role: **8**');
    expect(output).toContain('AFK中: **3**');
    expect(output).toContain('開催中Poll: **2**');
    expect(output).toContain('有効Plugin: **12**');
    expect(output).not.toContain('有効Rule');
  });

  it('Bot除外時は完全なmember cacheから人間だけを数える', () => {
    const config = { ...normalizeServerStatsConfig(undefined), includeBots: false };
    const output = formatServerStats(guild, metrics, config);
    expect(output).toContain('メンバー: **115**（Bot除外）');
  });

  it('Activityの成功率と作成コンテンツ数を表示する', () => {
    const output = formatServerActivity(
      {
        commands: 20,
        successfulCommands: 18,
        failedCommands: 2,
        suggestionsCreated: 3,
        pollsCreated: 4,
        giveawaysCreated: 1,
      },
      7,
    );
    expect(output).toContain('成功率: **90%**');
    expect(output).toContain('新規Poll: **4**');
  });

  it('Plugin一覧をDiscord文字数上限内へページ分割する', () => {
    const plugins = Array.from({ length: 80 }, (_, index) => ({
      id: `plugin-${index}`,
      name: `Plugin ${index} ${'x'.repeat(30)}`,
      version: '1.0.0',
    }));
    const pages = formatPluginPages(plugins);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1900)).toBe(true);
  });
});
