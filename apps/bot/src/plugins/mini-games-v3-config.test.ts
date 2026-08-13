import { describe, expect, it } from 'vitest';
import { miniGamesManifest } from '@herta/plugin-catalog';

describe('Mini Games v3 config', () => {
  it('leaderboardEnabledは旧v2設定を壊さないoptional設定にする', () => {
    const schema = miniGamesManifest.configSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.properties).toHaveProperty('leaderboardEnabled');
    expect(schema.required).not.toContain('leaderboardEnabled');
    expect(schema.required).not.toContain('statsEnabled');
  });

  it('DiceとArcade Leaderboardの入力範囲をManifestで制限する', () => {
    const dice = miniGamesManifest.commands.find((command) => command.name === 'dice');
    expect(dice?.options?.find((option) => option.name === 'count')).toMatchObject({
      minValue: 1,
      maxValue: 10,
    });
    expect(dice?.options?.find((option) => option.name === 'sides')).toMatchObject({
      minValue: 2,
      maxValue: 100,
    });

    const leaderboard = miniGamesManifest.commands.find(
      (command) => command.name === 'gameleaderboard',
    );
    expect(leaderboard?.options?.find((option) => option.name === 'limit')).toMatchObject({
      minValue: 5,
      maxValue: 25,
    });
  });
});
