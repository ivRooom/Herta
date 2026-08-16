import { describe, expect, it } from 'vitest';
import { miniGamesManifest } from '@herta/plugin-catalog';
import { arcadeMetricLabel, formatArcadeLeaderboard } from './mini-games-v3.js';

describe('Mini Games v3', () => {
  it('ManifestへDice・チンチロ・Arcade Leaderboard・あみだくじを登録する', () => {
    expect(miniGamesManifest.version).toBe('3.2.0');
    expect(miniGamesManifest.commands.map((command) => command.name)).toEqual([
      'coinflip',
      'highlow',
      'blackjack',
      'gamestats',
      'dice',
      'chinchiro',
      'gameleaderboard',
      'amidakuji',
    ]);
    const leaderboard = miniGamesManifest.commands.find(
      (command) => command.name === 'gameleaderboard',
    );
    const choices = leaderboard?.options?.find((option) => option.name === 'metric')?.choices ?? [];
    expect(choices).toHaveLength(7);
    expect(new Set(choices.map((choice) => choice.value)).size).toBe(choices.length);

    const amidakuji = miniGamesManifest.commands.find((command) => command.name === 'amidakuji');
    expect(amidakuji?.options?.find((option) => option.name === 'results')).toMatchObject({
      type: 'string',
      required: undefined,
    });
  });

  it('Arcade LeaderboardへTop 3メダルと指標単位を表示する', () => {
    const message = formatArcadeLeaderboard('highlow_best_streak', [
      { userId: '100', value: 12 },
      { userId: '200', value: 9 },
      { userId: '300', value: 7 },
      { userId: '400', value: 5 },
    ]);
    expect(message).toContain('🥇 <@100>');
    expect(message).toContain('🥈 <@200>');
    expect(message).toContain('🥉 <@300>');
    expect(message).toContain('4. <@400>');
    expect(message).toContain('12連勝');
  });

  it('ランキングデータがない場合はEmpty Stateを表示する', () => {
    expect(formatArcadeLeaderboard('chinchiro_wins', [])).toContain(
      'まだランキングデータがありません。',
    );
    expect(arcadeMetricLabel('dice_sixes')).toBe('Dice 6の目');
  });
});
