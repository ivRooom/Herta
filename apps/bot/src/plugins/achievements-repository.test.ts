import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { getAchievementMetrics } from './achievements-repository.js';

describe('Achievement repository', () => {
  it('Mini Games MetricsのSQL aliasを閉じて値を正しく返す', async () => {
    let capturedSql = '';
    const prisma = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        capturedSql = strings.join('?');
        return [
          {
            xp: 0n,
            messages: 0n,
            reactionsGiven: 0n,
            reactionsReceived: 0n,
            voiceSeconds: 0n,
            minecraftSeconds: 0n,
            pollVotes: 0n,
            giveawayEntries: 0n,
            eventGoing: 0n,
            suggestions: 0n,
            acceptedSuggestions: 0n,
            challengeCompletions: 0n,
            seasonPoints: 0n,
            minigamePlays: 12n,
            minigameWins: 5n,
            coinflipWins: 2n,
            highLowBestStreak: 7n,
            highLowClears: 1n,
            blackjackWins: 3n,
            blackjackNaturals: 1n,
          },
        ];
      },
    } as unknown as PrismaClient;

    const metrics = await getAchievementMetrics(
      prisma,
      'guild-1',
      'user-1',
      new Date('2026-08-13T00:00:00Z'),
    );

    expect(capturedSql).toContain('AS "blackjackWins"');
    expect(capturedSql).toContain('AS "blackjackNaturals"');
    expect(metrics.minigamePlays).toBe(12);
    expect(metrics.blackjackWins).toBe(3);
    expect(metrics.blackjackNaturals).toBe(1);
  });
});
