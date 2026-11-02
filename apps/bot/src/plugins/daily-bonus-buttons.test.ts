import { describe, expect, it } from 'vitest';
import { dailyBonusActionRow } from './daily-bonus-buttons.js';

describe('09:00 Discord daily bonus action row', () => {
  it.each([
    [false, 'daily-bonus:questions:2026-11-02'],
    [true, 'daily-participation:questions:2026-11-02'],
  ])('shows all three buttons with V2 enabled=%s', (enabled, questionId) => {
    const row = dailyBonusActionRow('2026-11-02', enabled).toJSON();
    expect(row.components).toHaveLength(3);
    expect(row.components.map((component) => ('custom_id' in component ? component.custom_id : null))).toEqual([
      'daily-bonus:2026-11-02',
      questionId,
      'daily-bonus:fortune:2026-11-02',
    ]);
    expect(row.components.map((component) => component.label)).toEqual([
      '🎁 ボーナスを受け取る',
      '🧠 今日の問題に挑戦',
      '🔮 今日の運勢',
    ]);
  });
});
