import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { checkCategoryGate, leaderboardCommand } from './leaderboard.js';

function mockPrisma(guildPluginRow: unknown): PrismaClient {
  return {
    guildPlugin: {
      findUnique: vi.fn().mockResolvedValue(guildPluginRow),
    },
  } as unknown as PrismaClient;
}

describe('leaderboardCommand definition', () => {
  it('10個のカテゴリ選択肢を定義する', () => {
    const categoryOption = leaderboardCommand.definition.options?.find(
      (option) => option.name === 'category',
    );
    expect(categoryOption?.choices).toHaveLength(10);
    expect(categoryOption?.required).toBe(true);
  });
});

describe('checkCategoryGate', () => {
  it('Pluginに依存しないカテゴリ（messages等）は常に利用可能', async () => {
    const prisma = mockPrisma(null);
    const result = await checkCategoryGate(prisma, 'guild-1', 'messages');
    expect(result).toEqual({ available: true });
  });

  it('対応Pluginがguild_pluginsへ未登録なら利用不可', async () => {
    const prisma = mockPrisma(null);
    const result = await checkCategoryGate(prisma, 'guild-1', 'xp');
    expect(result.available).toBe(false);
  });

  it('guild_plugins.enabledがfalseなら利用不可', async () => {
    const prisma = mockPrisma({ enabled: false, config: {} });
    const result = await checkCategoryGate(prisma, 'guild-1', 'achievements');
    expect(result.available).toBe(false);
  });

  it('config.enabledがfalseなら利用不可', async () => {
    const prisma = mockPrisma({ enabled: true, config: { enabled: false } });
    const result = await checkCategoryGate(prisma, 'guild-1', 'season');
    expect(result.available).toBe(false);
  });

  it('有効化済みなら利用可能', async () => {
    const prisma = mockPrisma({ enabled: true, config: { enabled: true } });
    const result = await checkCategoryGate(prisma, 'guild-1', 'xp');
    expect(result).toEqual({ available: true });
  });

  it('minigamesはleaderboardEnabled:falseなら利用不可', async () => {
    const prisma = mockPrisma({
      enabled: true,
      config: { enabled: true, leaderboardEnabled: false },
    });
    const result = await checkCategoryGate(prisma, 'guild-1', 'minigames');
    expect(result.available).toBe(false);
  });
});
