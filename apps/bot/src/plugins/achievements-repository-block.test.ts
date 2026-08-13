import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@herta/db';
import {
  achievementIdFromBlockedRecord,
  blockedAchievementRecordId,
  syncAchievementUnlocks,
} from './achievements-repository.js';

describe('achievement manual revoke suppression', () => {
  it('blocked record IDを相互変換できる', () => {
    expect(blockedAchievementRecordId('first-message')).toBe('blocked:first-message');
    expect(achievementIdFromBlockedRecord('blocked:first-message')).toBe('first-message');
    expect(achievementIdFromBlockedRecord('first-message')).toBeNull();
  });

  it('手動取消されたAchievementを自動同期で再解除しない', async () => {
    const inserted: string[] = [];
    const tx = {
      async $queryRaw(strings: TemplateStringsArray) {
        if (strings.join('').includes('pg_advisory_xact_lock')) return [];
        return [{ achievementId: 'blocked:first-message' }];
      },
      async $executeRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
        const achievementId = values.at(-1);
        if (typeof achievementId === 'string') inserted.push(achievementId);
        return 1;
      },
    };
    const prisma = {
      async $transaction<T>(callback: (client: typeof tx) => Promise<T>) {
        return callback(tx);
      },
    } as unknown as PrismaClient;

    const result = await syncAchievementUnlocks(prisma, 'guild', 'user', [
      'first-message',
      'first-reaction',
    ]);

    expect(result).toEqual(['first-reaction']);
    expect(inserted).toEqual(['first-reaction']);
  });
});
