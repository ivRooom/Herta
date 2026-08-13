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
});
