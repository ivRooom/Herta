import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { getAchievementMetrics, syncAchievementUnlocks } from './achievements-repository.js';

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
  it('advisory lock uses executeRaw without deserializing void', async () => {
    const steps: string[] = [];
    const tx = {
      $executeRaw: async (sql: TemplateStringsArray) => {
        steps.push('execute:' + sql.join('?'));
        return 1;
      },
      $queryRaw: async (sql: TemplateStringsArray) => {
        steps.push('query:' + sql.join('?'));
        return [{ achievementId: 'already-unlocked' }];
      },
    };
    const prisma = {
      $transaction: async (callback: (client: typeof tx) => Promise<string[]>) => callback(tx),
    } as unknown as PrismaClient;
    const unlocked = await syncAchievementUnlocks(prisma, 'guild', 'member', ['already-unlocked']);
    expect(unlocked).toEqual([]);
    expect(steps[0]).toContain('execute:SELECT pg_advisory_xact_lock');
    expect(steps[1]).toContain('query:');
  });

});
