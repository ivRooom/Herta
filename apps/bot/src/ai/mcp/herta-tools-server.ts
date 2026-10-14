import type { PrismaClient } from '@herta/db';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listXpLeaderboard } from '../../plugins/xp-level-repository.js';

const DEFAULT_LEADERBOARD_LIMIT = 10;
const MAX_LEADERBOARD_LIMIT = 25;

/**
 * Herta自身のデータだけを読む自作MCPサーバー(Phase 1: XPランキング参照のみ)。
 *
 * guildIdはツールのinput schemaに一切含めず、このサーバーインスタンスを生成する時点で
 * closureへ固定する。モデルがプロンプトインジェクションでどう言おうと、ここで渡された
 * guild以外のデータへは構造的に到達できない(ランタイム検証ではなく、そもそも引数として
 * 存在しない)。
 */
export function createHertaToolsMcpServer(prisma: PrismaClient, guildId: string): McpServer {
  const server = new McpServer({ name: 'herta-tools', version: '1.0.0' });

  server.registerTool(
    'get_guild_xp_leaderboard',
    {
      title: 'Guild XPランキング取得',
      description:
        'このDiscordサーバー(Guild)のXPランキング上位を取得します。他のサーバーのデータは取得できません。',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LEADERBOARD_LIMIT)
          .optional()
          .describe(
            `取得する上位件数(1-${MAX_LEADERBOARD_LIMIT}の整数、省略時は${DEFAULT_LEADERBOARD_LIMIT})`,
          ),
      },
    },
    async ({ limit }) => {
      const resolvedLimit = Math.max(
        1,
        Math.min(limit ?? DEFAULT_LEADERBOARD_LIMIT, MAX_LEADERBOARD_LIMIT),
      );
      const rows = await listXpLeaderboard(prisma, guildId, resolvedLimit);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(rows.map((row) => ({ userId: row.userId, xp: row.xp }))),
          },
        ],
      };
    },
  );

  return server;
}
