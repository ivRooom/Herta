import { describe, expect, it } from 'vitest';
import {
  buildDailyBonusMessageContent,
  dailyBonusActionRow,
  dailyBonusTestActionRow,
  matchesDailyBonusMessageContent,
} from './daily-bonus-buttons.js';

describe('09:00 Discord daily bonus action row', () => {
  it.each([
    [false, 'daily-bonus:questions:2026-11-02'],
    [true, 'daily-participation:questions:2026-11-02'],
  ])('shows all five buttons with V2 enabled=%s', (enabled, questionId) => {
    const row = dailyBonusActionRow('2026-11-02', enabled).toJSON();
    expect(row.components).toHaveLength(5);
    expect(
      row.components.map((component) => ('custom_id' in component ? component.custom_id : null)),
    ).toEqual([
      'daily-bonus:2026-11-02',
      questionId,
      'daily-participation:yesterday:2026-11-02',
      'daily-bonus:fortune:2026-11-02',
      'daily-bonus:quests:2026-11-02',
    ]);
    expect(
      row.components.map((component) => ('label' in component ? component.label : null)),
    ).toEqual([
      '🎁 ボーナスを受け取る',
      '🧠 今日の問題に挑戦',
      '📚 昨日の問題',
      '🔮 今日の運勢',
      '📋 クエストを確認',
    ]);
  });

  it('builds the announcement content with an optional video line', () => {
    expect(buildDailyBonusMessageContent('123', null)).toBe('<@&123>');
    expect(buildDailyBonusMessageContent('123', 'https://example.test/movie.mp4')).toBe(
      '<@&123>\nhttps://example.test/movie.mp4',
    );
  });

  it('matches only the mention and the mention + video line shapes', () => {
    expect(matchesDailyBonusMessageContent('<@&123>', '123')).toBe(true);
    expect(matchesDailyBonusMessageContent('<@&123>\nhttps://example.test/movie.mp4', '123')).toBe(
      true,
    );
    expect(matchesDailyBonusMessageContent('<@&123>\nhttp://example.test/movie.mp4', '123')).toBe(
      false,
    );
    expect(matchesDailyBonusMessageContent('<@&123>\nhttps://example.test/a b', '123')).toBe(false);
    expect(matchesDailyBonusMessageContent('<@&123> extra', '123')).toBe(false);
    expect(matchesDailyBonusMessageContent('<@&999>', '123')).toBe(false);
    expect(matchesDailyBonusMessageContent('<@&123>\n', '123')).toBe(false);
  });

  it('shows the same five actions on the TEST row with inert ids', () => {
    const row = dailyBonusTestActionRow('req-1').toJSON();
    expect(row.components).toHaveLength(5);
    expect(
      row.components.map((component) => ('custom_id' in component ? component.custom_id : null)),
    ).toEqual([
      'daily-bonus-test:req-1:claim',
      'daily-bonus-test:req-1:questions',
      'daily-bonus-test:req-1:yesterday',
      'daily-bonus-test:req-1:fortune',
      'daily-bonus-test:req-1:quests',
    ]);
  });
});
