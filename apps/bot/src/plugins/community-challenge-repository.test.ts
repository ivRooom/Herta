import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@herta/db';
import {
  ensureCommunityChallengeAssignment,
  syncCommunityChallengeCompletions,
} from './community-challenge-repository.js';

describe('Community Challenge transaction advisory locks', () => {
  it('uses executeRaw for both assignment and completion without reading void', async () => {
    const lockCalls: string[] = [];
    const record = {
      periodType: 'daily' as const,
      periodKey: '2026-11-05',
      challengeIds: ['message-1'],
      createdAt: new Date('2026-11-05T00:00:00Z'),
    };
    const tx = {
      $executeRaw: async (sql: TemplateStringsArray) => {
        lockCalls.push(sql.join('?'));
        return 1;
      },
      $queryRaw: async (sql: TemplateStringsArray) => {
        const query = sql.join('?');
        if (query.includes('community_challenge_assignments')) return [record];
        return [{ challengeId: 'message-1' }];
      },
    };
    const prisma = {
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as PrismaClient;
    const assignment = await ensureCommunityChallengeAssignment(
      prisma, 'guild', 'daily', '2026-11-05', ['message-1'],
    );
    expect(assignment).toEqual(record);
    const definition = {
      id: 'message-1',
      metric: 'messages',
      target: 1,
      basePoints: 10,
    } as unknown as Parameters<typeof syncCommunityChallengeCompletions>[1]['definitions'][number];
    const input = {
      guildId: 'guild',
      userId: 'member',
      periodType: 'daily',
      periodKey: '2026-11-05',
      seasonKey: '2026-11',
      definitions: [definition],
      metrics: { messages: 1 },
      pointMultiplier: 1,
    } as unknown as Parameters<typeof syncCommunityChallengeCompletions>[1];
    expect(await syncCommunityChallengeCompletions(prisma, input)).toEqual([]);
    expect(lockCalls).toHaveLength(2);
    expect(lockCalls[0]).toContain('pg_advisory_xact_lock');
    expect(lockCalls[1]).toContain('pg_advisory_xact_lock');
    expect(lockCalls[0]).toContain('community-challenge-assignment');
    expect(lockCalls[1]).toContain('community-challenge');
  });
});
