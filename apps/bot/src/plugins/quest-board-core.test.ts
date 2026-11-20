import { describe, expect, it } from 'vitest';
import type { QuestBoardQuest, QuestBoardStatus } from './quest-board-ivrm.js';
import {
  buildQuestBoardCardEmbed,
  buildQuestBoardEmbed,
  buildQuestBoardErrorEmbed,
  buildQuestBoardPeriodSelect,
  embedCharacterCount,
  formatPeriodRange,
  formatProgressBar,
  formatProgressPercent,
  formatQuestBoardError,
  formatRemainingUntil,
  formatSlotDate,
  isAlmostComplete,
  isQuestBoardPeriodType,
  parseQuestBoardPeriodCustomId,
  questBoardCardFileName,
  EMBED_COLOR_ERROR,
  EMBED_COLOR_SUCCESS,
  MAX_EMBED_TOTAL_CHARS,
  MEMBER_QUEST_BOARD_URL,
} from './quest-board-core.js';

const user = '223456789012345678';

function quest(overrides: Partial<QuestBoardQuest> = {}): QuestBoardQuest {
  return {
    key: 'daily-msg-5',
    title: '発言',
    description: '',
    category: 'Discord',
    signalKey: 'xp_source:herta:herta:msg:',
    threshold: 5,
    unit: '回',
    xpReward: 20,
    prerequisiteQuestKey: null,
    prerequisiteTitle: null,
    locked: false,
    progress: 0,
    completed: false,
    recorded: false,
    ...overrides,
  };
}

function board(overrides: Partial<QuestBoardStatus> = {}): QuestBoardStatus {
  return {
    periods: [
      {
        periodType: 'daily',
        periodKey: '2026-11-20',
        startSlotDate: '2026-11-20',
        endSlotDate: '2026-11-20',
        endsAt: '2026-11-21T00:00:00.000Z',
        allClearPoints: 1,
        quests: [
          quest({ progress: 4 }),
          quest({
            key: 'daily-quiz-answer',
            title: 'クイズ回答',
            threshold: 1,
            unit: '回',
            xpReward: 15,
            progress: 1,
            completed: true,
            recorded: true,
          }),
        ],
        completedCount: 1,
        allClear: false,
      },
      {
        periodType: 'weekly',
        periodKey: '2026-W47',
        startSlotDate: '2026-11-16',
        endSlotDate: '2026-11-22',
        endsAt: '2026-11-23T00:00:00.000Z',
        allClearPoints: 5,
        quests: [],
        completedCount: 0,
        allClear: false,
      },
      {
        periodType: 'monthly',
        periodKey: '2026-11',
        startSlotDate: '2026-11-01',
        endSlotDate: '2026-11-30',
        endsAt: '2026-12-01T00:00:00.000Z',
        allClearPoints: 10,
        quests: [],
        completedCount: 0,
        allClear: false,
      },
    ],
    totalCompletions: 12,
    completionsByPeriod: { daily: 5, weekly: 4, monthly: 3 },
    history: [],
    ...overrides,
  };
}

describe('quest board progress formatting', () => {
  it('renders the progress bar with clamping', () => {
    expect(formatProgressBar(0, 5)).toBe('▱▱▱▱▱▱▱▱▱▱');
    expect(formatProgressBar(5, 5)).toBe('▰▰▰▰▰▰▰▰▰▰');
    expect(formatProgressBar(3, 5)).toBe('▰▰▰▰▰▰▱▱▱▱');
    expect(formatProgressBar(9, 5)).toBe('▰▰▰▰▰▰▰▰▰▰');
    expect(formatProgressBar(0, 0)).toBe('▰▰▰▰▰▰▰▰▰▰');
  });

  it('renders the progress percent with clamping', () => {
    expect(formatProgressPercent(1, 4)).toBe(25);
    expect(formatProgressPercent(4, 5)).toBe(80);
    expect(formatProgressPercent(12, 5)).toBe(100);
    expect(formatProgressPercent(0, 5)).toBe(0);
  });

  it('flags almost-complete quests at the 80% boundary only', () => {
    expect(isAlmostComplete(quest({ progress: 4, threshold: 5 }))).toBe(true);
    expect(isAlmostComplete(quest({ progress: 3, threshold: 5 }))).toBe(false);
    expect(isAlmostComplete(quest({ progress: 5, threshold: 5, completed: true }))).toBe(false);
    expect(isAlmostComplete(quest({ progress: 4, threshold: 5, locked: true }))).toBe(false);
  });

  it('formats the remaining time until the period closes', () => {
    const now = new Date('2026-11-20T03:00:00.000Z');
    expect(formatRemainingUntil('2026-11-20T05:30:00.000Z', now)).toBe('あと2時間30分');
    expect(formatRemainingUntil('2026-11-22T03:00:00.000Z', now)).toBe('あと2日0時間');
    expect(formatRemainingUntil('2026-11-20T03:30:00.000Z', now)).toBe('あと30分');
    expect(formatRemainingUntil('2026-11-20T02:00:00.000Z', now)).toBe('まもなくリセット');
    expect(formatRemainingUntil('not-a-date', now)).toBe('');
  });

  it('formats slot dates and period ranges', () => {
    expect(formatSlotDate('2026-11-20')).toBe('11月20日');
    expect(formatSlotDate('2026-11-05')).toBe('11月5日');
    const value = board();
    expect(formatPeriodRange(value.periods[0]!)).toBe('11月20日');
    expect(formatPeriodRange(value.periods[1]!)).toBe('11月16日〜11月22日');
  });
});

describe('quest board embed', () => {
  it('shows progress, the all-clear path and per-quest bars', () => {
    const embed = buildQuestBoardEmbed(board(), 'daily', new Date('2026-11-20T03:00:00.000Z'));
    expect(embed.title).toContain('デイリー');
    expect(embed.description).toContain('1/2 クリア');
    expect(embed.description).toContain('全クリアまで あと 1 本');
    expect(embed.description).toContain('あと少し');
    expect(embed.description).toContain('あと 1 回');
    expect(embed.footer?.text).toContain('累計クリア 12 件');
    expect(embed.footer?.text).toContain(MEMBER_QUEST_BOARD_URL);
    const fieldsJson = JSON.stringify(embed.fields);
    expect(fieldsJson).toContain('✅ クイズ回答');
    expect(fieldsJson).toContain('クリア済みです');
    expect(fieldsJson).toContain('▰▰▰▰▰▰▰▰▱▱');
    expect(fieldsJson).toContain('4 / 5 回（80%）');
    expect(embedCharacterCount(embed)).toBeLessThanOrEqual(MAX_EMBED_TOTAL_CHARS);
  });

  it('celebrates an all-clear period', () => {
    const value = board();
    value.periods[0] = {
      ...value.periods[0]!,
      completedCount: 2,
      allClear: true,
      quests: value.periods[0]!.quests.map((entry) => ({
        ...entry,
        progress: entry.threshold,
        completed: true,
        recorded: true,
      })),
    };
    const embed = buildQuestBoardEmbed(value, 'daily');
    expect(embed.description).toContain('全クリア達成');
    expect(embed.description).toContain('1 pt');
    expect(embed.description).not.toContain('全クリアまで');
  });

  it('explains locked quests through their prerequisite', () => {
    const value = board();
    value.periods[0] = {
      ...value.periods[0]!,
      quests: [
        quest({
          key: 'daily-msg-20',
          title: 'たくさん発言',
          threshold: 20,
          locked: true,
          prerequisiteQuestKey: 'daily-msg-5',
          prerequisiteTitle: '発言',
        }),
      ],
      completedCount: 0,
    };
    const embed = buildQuestBoardEmbed(value, 'daily');
    const fieldsJson = JSON.stringify(embed.fields);
    expect(fieldsJson).toContain('🔒 たくさん発言');
    expect(fieldsJson).toContain('前提クエスト「発言」をクリアすると解放されます');
  });

  it('answers a neutral embed for a period without quests', () => {
    const embed = buildQuestBoardEmbed(board(), 'weekly');
    expect(embed.title).toContain('ウィークリー');
    expect(embed.description).toContain('現在表示できるクエストがありません');
    expect(embed.fields).toBeUndefined();
  });

  it('answers an error notice for a missing period', () => {
    const value = board();
    value.periods = value.periods.filter((period) => period.periodType !== 'monthly');
    const embed = buildQuestBoardEmbed(value, 'monthly');
    expect(embed.color).toBe(EMBED_COLOR_ERROR);
    expect(embed.description).toContain('期間データを取得できませんでした');
  });
});

describe('quest board period select', () => {
  it('builds the menu data with the owner id in the custom id', () => {
    const data = buildQuestBoardPeriodSelect(user, 'weekly');
    expect(data.customId).toBe(`quest-board:period:${user}`);
    expect(data.options.map((option) => option.value)).toEqual(['daily', 'weekly', 'monthly']);
    expect(data.options.map((option) => option.default)).toEqual([false, true, false]);
    expect(parseQuestBoardPeriodCustomId(data.customId)).toEqual({ userId: user });
  });

  it('rejects foreign or malformed custom ids', () => {
    expect(parseQuestBoardPeriodCustomId('game-accounts:ranking:axis:1')).toBeNull();
    expect(parseQuestBoardPeriodCustomId('quest-board:period:not-a-snowflake')).toBeNull();
    expect(parseQuestBoardPeriodCustomId('quest-board:period:')).toBeNull();
  });

  it('guards period types', () => {
    expect(isQuestBoardPeriodType('daily')).toBe(true);
    expect(isQuestBoardPeriodType('yearly')).toBe(false);
  });
});

describe('quest board card companion embed', () => {
  it('names the attachment per period', () => {
    expect(questBoardCardFileName('daily')).toBe('quest-board-daily.png');
    expect(questBoardCardFileName('weekly')).toBe('quest-board-weekly.png');
    expect(questBoardCardFileName('monthly')).toBe('quest-board-monthly.png');
  });

  it('carries only the all-clear state and callouts, not the quest list', () => {
    const embed = buildQuestBoardCardEmbed(board(), 'daily', new Date('2026-11-20T03:00:00.000Z'));
    expect(embed.title).toContain('デイリー');
    // One of two quests is recorded: one remains, worth 1 pt, and
    // the incomplete quest's 20 XP is still on the table.
    expect(embed.description).toContain('全クリアまで あと 1 本（全クリアで 1 pt）・ 残り 20 XP');
    // The 4/5 quest is at 80%: the almost-complete callout appears.
    expect(embed.description).toContain('あと少し： 「発言」あと 1 回');
    // The quest list itself is the card's job, not the embed's.
    expect(embed.fields).toBeUndefined();
    expect(embed.footer?.text).toContain('累計クリア');
    expect(embed.footer?.text).toContain(MEMBER_QUEST_BOARD_URL);
  });

  it('celebrates an all-clear board', () => {
    const cleared = board();
    const daily = cleared.periods[0]!;
    daily.allClear = true;
    daily.completedCount = daily.quests.length;
    const embed = buildQuestBoardCardEmbed(cleared, 'daily');
    expect(embed.color).toBe(EMBED_COLOR_SUCCESS);
    expect(embed.description).toContain('全クリア達成！');
    expect(embed.description).toContain('1 pt');
  });
});

describe('quest board error embeds', () => {
  it('maps every failure state to its guidance text', () => {
    expect(formatQuestBoardError({ status: 'not-linked' })).toContain('会員連携が見つかりません');
    expect(formatQuestBoardError({ status: 'not-linked' })).toContain(MEMBER_QUEST_BOARD_URL);
    expect(formatQuestBoardError({ status: 'duplicate' })).toContain('重複しています');
    expect(formatQuestBoardError({ status: 'disabled' })).toContain('現在利用できません');
    expect(formatQuestBoardError({ status: 'ineligible-guild' })).toContain('対象外です');
    expect(formatQuestBoardError({ status: 'unconfigured' })).toContain('未設定です');
    expect(formatQuestBoardError({ status: 'unavailable' })).toContain('接続できません');
    const embed = buildQuestBoardErrorEmbed({ status: 'unavailable' });
    expect(embed.color).toBe(EMBED_COLOR_ERROR);
    expect(embed.description).toContain('接続できません');
  });
});
