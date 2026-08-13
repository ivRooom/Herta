import { describe, expect, it } from 'vitest';
import { achievementsManifest, communityChallengeManifest } from '@herta/plugin-catalog';
import {
  ACHIEVEMENTS,
  COMMUNITY_CHALLENGES,
  communityChallengeMetricLabel,
  selectCommunityChallenges,
} from '@herta/shared';
import { isMiniGameAchievementInteraction } from './achievements.js';
import { isMiniGameChallengeInteraction } from './community-challenge.js';

function miniGameInteraction(input: {
  commandName?: string;
  customId?: string;
  bot?: boolean;
  guildId?: string | null;
}) {
  return {
    guildId: input.guildId === undefined ? '12345' : input.guildId,
    user: { id: '67890', bot: input.bot ?? false },
    guild: null,
    ...(input.commandName ? { commandName: input.commandName } : {}),
    ...(input.customId ? { customId: input.customId } : {}),
    isChatInputCommand: () => Boolean(input.commandName),
    isButton: () => Boolean(input.customId),
  };
}

describe('Mini Games v2 integrations', () => {
  it('Gamesカテゴリへ11個のBuilt-in Achievementを追加する', () => {
    const games = ACHIEVEMENTS.filter((achievement) => achievement.category === 'games');
    expect(games).toHaveLength(11);
    expect(games.map((achievement) => achievement.id)).toEqual(
      expect.arrayContaining([
        'arcade-debut',
        'arcade-winner',
        'lucky-call',
        'highlow-ten',
        'highlow-perfect',
        'natural-21',
        'blackjack-shark',
      ]),
    );
  });

  it('Games Achievementはゲーム専用Metricだけを利用する', () => {
    const gameMetrics = new Set([
      'minigamePlays',
      'minigameWins',
      'coinflipWins',
      'highLowBestStreak',
      'highLowClears',
      'blackjackWins',
      'blackjackNaturals',
    ]);
    const games = ACHIEVEMENTS.filter((achievement) => achievement.category === 'games');
    expect(
      games.every(
        (achievement) => achievement.metric !== undefined && gameMetrics.has(achievement.metric),
      ),
    ).toBe(true);
  });

  it('Daily/Weeklyへ合計24個のMini Games Challengeを追加する', () => {
    const metrics = new Set([
      'minigame_plays',
      'minigame_wins',
      'highlow_round_wins',
      'blackjack_wins',
    ]);
    const games = COMMUNITY_CHALLENGES.filter((challenge) => metrics.has(challenge.metric));
    expect(games).toHaveLength(24);
    expect(games.filter((challenge) => challenge.period === 'daily')).toHaveLength(12);
    expect(games.filter((challenge) => challenge.period === 'weekly')).toHaveLength(12);
    expect(communityChallengeMetricLabel('blackjack_wins')).toBe('Blackjack Wins');
  });

  it('Mini Games Challengeは既定では配布せず、明示ONで候補化する', () => {
    const withoutGames = Array.from({ length: 40 }, (_, index) =>
      selectCommunityChallenges({
        guildId: 'guild',
        period: 'daily',
        periodKey: `2026-08-${String(index + 1).padStart(2, '0')}`,
        count: 5,
        includeMinecraft: true,
      }),
    ).flat();
    expect(withoutGames.some((challenge) => challenge.metric.startsWith('minigame_'))).toBe(false);
    expect(withoutGames.some((challenge) => challenge.metric === 'highlow_round_wins')).toBe(false);
    expect(withoutGames.some((challenge) => challenge.metric === 'blackjack_wins')).toBe(false);

    const withGames = Array.from({ length: 40 }, (_, index) =>
      selectCommunityChallenges({
        guildId: 'guild',
        period: 'daily',
        periodKey: `games-${index}`,
        count: 5,
        includeMinecraft: true,
        includeMiniGames: true,
      }),
    ).flat();
    expect(
      withGames.some(
        (challenge) =>
          challenge.metric.startsWith('minigame_') ||
          challenge.metric === 'highlow_round_wins' ||
          challenge.metric === 'blackjack_wins',
      ),
    ).toBe(true);
  });

  it('Mini GamesのSlash/ButtonだけをAchievement・Challenge自動同期対象にする', () => {
    const slash = miniGameInteraction({ commandName: 'blackjack' });
    const button = miniGameInteraction({
      customId: 'herta:mini-games:v1:highlow:0123456789abcdef0123456789abcdef:higher',
    });
    const unrelated = miniGameInteraction({ commandName: 'poll' });
    const bot = miniGameInteraction({ commandName: 'coinflip', bot: true });

    expect(isMiniGameAchievementInteraction(slash)).toBe(true);
    expect(isMiniGameChallengeInteraction(slash)).toBe(true);
    expect(isMiniGameAchievementInteraction(button)).toBe(true);
    expect(isMiniGameChallengeInteraction(button)).toBe(true);
    expect(isMiniGameAchievementInteraction(unrelated)).toBe(false);
    expect(isMiniGameChallengeInteraction(unrelated)).toBe(false);
    expect(isMiniGameAchievementInteraction(bot)).toBe(false);
    expect(isMiniGameChallengeInteraction(bot)).toBe(false);
  });

  it('AchievementとCommunity ChallengeはMini Games同期のためにinteractionCreateへ依存しない', () => {
    expect(achievementsManifest.events).not.toContain('interactionCreate');
    expect(communityChallengeManifest.events).not.toContain('interactionCreate');
  });

  it('High-Low実績は最小3ラウンド設定でも到達可能にする', () => {
    const heater = ACHIEVEMENTS.find((achievement) => achievement.id === 'highlow-five');
    const master = ACHIEVEMENTS.find((achievement) => achievement.id === 'highlow-ten');
    expect(heater).toMatchObject({ metric: 'highLowBestStreak', target: 3 });
    expect(master).toMatchObject({ metric: 'highLowClears', target: 10 });
  });
});
