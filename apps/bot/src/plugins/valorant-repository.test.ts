import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { deleteValorantLink, getValorantLink, upsertValorantLink } from './valorant-repository.js';

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    valorantAccountLink: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe('getValorantLink', () => {
  it('レコードが無ければnullを返す', async () => {
    const prisma = mockPrisma();
    expect(await getValorantLink(prisma, 'guild-1', 'user-1')).toBeNull();
  });

  it('レコードをValorantLinkRecordへマップする', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ riotName: 'Player', riotTag: 'JP1', region: 'ap' });
    const prisma = mockPrisma({ findUnique });

    const result = await getValorantLink(prisma, 'guild-1', 'user-1');
    expect(result).toEqual({ riotName: 'Player', riotTag: 'JP1', region: 'ap' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { guildId_userId: { guildId: 'guild-1', userId: 'user-1' } },
    });
  });
});

describe('upsertValorantLink', () => {
  it('guildId+userIdをキーにupsertする', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = mockPrisma({ upsert });

    await upsertValorantLink(prisma, 'guild-1', 'user-1', { name: 'Player', tag: 'JP1' }, 'na');

    expect(upsert).toHaveBeenCalledWith({
      where: { guildId_userId: { guildId: 'guild-1', userId: 'user-1' } },
      create: {
        guildId: 'guild-1',
        userId: 'user-1',
        riotName: 'Player',
        riotTag: 'JP1',
        region: 'na',
      },
      update: { riotName: 'Player', riotTag: 'JP1', region: 'na' },
    });
  });
});

describe('deleteValorantLink', () => {
  it('削除に成功したらtrueを返す', async () => {
    const prisma = mockPrisma();
    expect(await deleteValorantLink(prisma, 'guild-1', 'user-1')).toBe(true);
  });

  it('レコードが無い(delete失敗)場合はfalseを返す', async () => {
    const del = vi.fn().mockRejectedValue(new Error('not found'));
    const prisma = mockPrisma({ delete: del });
    expect(await deleteValorantLink(prisma, 'guild-1', 'user-1')).toBe(false);
  });
});
