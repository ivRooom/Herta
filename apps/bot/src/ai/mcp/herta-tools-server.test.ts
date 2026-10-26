import type { PrismaClient } from '@herta/db';
import { describe, expect, it } from 'vitest';
import { connectHertaToolsMcpClient } from './client.js';
import { createHertaToolsMcpServer } from './herta-tools-server.js';

function fakePrisma(
  rows: Array<{ guildId: string; userId: string; xp: number; lastXpAt: Date | null }>,
): PrismaClient {
  return {
    // listXpLeaderboard(prisma, guildId, limit)はSQLテンプレートの値を[guildId, limit]の順で
    // 埋め込む。実DBの代わりにLIMIT相当をここでJS側で再現する。
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const limit = Number(values[1]);
      return rows.slice(0, limit).map((row) => ({ ...row, xp: BigInt(row.xp) }));
    },
  } as unknown as PrismaClient;
}

describe('createHertaToolsMcpServer / connectHertaToolsMcpClient', () => {
  it('get_guild_xp_leaderboardのinput schemaはguildIdを持たない(他Guildを指定する手段が無い)', async () => {
    const connection = await connectHertaToolsMcpClient(
      createHertaToolsMcpServer(fakePrisma([]), 'guild-1'),
    );
    try {
      expect(connection.tools).toHaveLength(1);
      const tool = connection.tools[0]!;
      expect(tool.name).toBe('get_guild_xp_leaderboard');
      const properties = tool.parameters['properties'] as Record<string, unknown> | undefined;
      expect(properties).not.toHaveProperty('guildId');
      expect(properties).toHaveProperty('limit');
      expect(properties?.['limit']).toMatchObject({ type: 'integer', minimum: 1, maximum: 25 });
    } finally {
      await connection.close();
    }
  });

  it('サーバー生成時にclosureへ固定したguildId分のXPランキングだけを返す', async () => {
    const connection = await connectHertaToolsMcpClient(
      createHertaToolsMcpServer(
        fakePrisma([
          { guildId: 'guild-1', userId: 'user-1', xp: 100, lastXpAt: null },
          { guildId: 'guild-1', userId: 'user-2', xp: 50, lastXpAt: null },
        ]),
        'guild-1',
      ),
    );
    try {
      const result = await connection.callTool('get_guild_xp_leaderboard', {});
      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.text) as Array<{ userId: string; xp: number }>;
      expect(parsed).toEqual([
        { userId: 'user-1', xp: 100 },
        { userId: 'user-2', xp: 50 },
      ]);
    } finally {
      await connection.close();
    }
  });

  it('limit省略時は既定10件、上限25件を超える値はtool schema側で拒否される', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      guildId: 'guild-1',
      userId: `user-${index}`,
      xp: 30 - index,
      lastXpAt: null,
    }));
    const connection = await connectHertaToolsMcpClient(
      createHertaToolsMcpServer(fakePrisma(rows), 'guild-1'),
    );
    try {
      const defaultResult = await connection.callTool('get_guild_xp_leaderboard', {});
      expect(defaultResult.isError).toBe(false);
      expect((JSON.parse(defaultResult.text) as unknown[]).length).toBe(10);

      const maxResult = await connection.callTool('get_guild_xp_leaderboard', { limit: 25 });
      expect(maxResult.isError).toBe(false);
      expect((JSON.parse(maxResult.text) as unknown[]).length).toBe(25);

      const overLimitResult = await connection.callTool('get_guild_xp_leaderboard', {
        limit: 999,
      });
      expect(overLimitResult.isError).toBe(true);
      for (const limit of [0, 1.5, '10']) {
        const invalid = await connection.callTool('get_guild_xp_leaderboard', { limit });
        expect(invalid.isError).toBe(true);
      }
    } finally {
      await connection.close();
    }
  });
});
