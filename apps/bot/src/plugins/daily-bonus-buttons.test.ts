import { describe, expect, it } from 'vitest';
import { dailyBonusActionRow, MEMBER_DAILY_URL } from './daily-bonus-buttons.js';

describe('09:00 Discord daily bonus action row', () => {
  it.each([
    [false, 'daily-bonus:questions:2026-11-02'],
    [true, 'daily-participation:questions:2026-11-02'],
  ])('shows all four buttons with V2 enabled=%s', (enabled, questionId) => {
    const row = dailyBonusActionRow('2026-11-02', enabled).toJSON();
    expect(row.components).toHaveLength(5);
    expect(
      row.components.map((component) => ('custom_id' in component ? component.custom_id : null)),
    ).toEqual([
      'daily-bonus:2026-11-02',
      questionId,
      'daily-participation:yesterday:2026-11-02',
      'daily-bonus:fortune:2026-11-02',
      null,
    ]);
    expect(
      row.components.map((component) => ('label' in component ? component.label : null)),
    ).toEqual([
      '🎁 ボーナスを受け取る',
      '🧠 今日の問題に挑戦',
      '📚 昨日の問題',
      '🔮 今日の運勢',
      '🌐 Webで開く',
    ]);
    const link = row.components[4];
    expect('url' in link ? link.url : null).toBe(MEMBER_DAILY_URL);
    expect(MEMBER_DAILY_URL).toBe('https://member.ivrm.jp/participation');
  });
});
