import type { Logger } from 'pino';
import type { PluginManifest } from '@herta/shared';

/** Guild 単位で Plugin に提供される実行コンテキスト */
export interface PluginRuntimeContext<TConfig, TClient = unknown, TPrisma = unknown> {
  /** Discord クライアント */
  client: TClient;
  /** Prisma クライアント */
  prisma: TPrisma;
  /** Plugin スコープのロガー */
  logger: Logger;
  /** 対象 Guild の ID */
  guildId: string;
  /** 対象 Guild の Plugin 設定 */
  config: TConfig;
  /** 実行中 Plugin の manifest */
  manifest: PluginManifest;
  /**
   * メンバーの能動的な参加行動をCommunity Pointsへ加点する。Activity Rulesの
   * 設定(有効/無効・単価・1日上限・除外Role)の判定はhost側(apps/bot)で行い、
   * Pluginは加点対象のmetric名とuserIdだけを渡す。host側がこれを提供しない
   * 環境(テスト等)ではundefinedになる。
   */
  onCommunityAction?: (metric: string, userId: string) => Promise<void>;
}

export interface CreatePluginContextOptions<TConfig, TClient, TPrisma> {
  client: TClient;
  prisma: TPrisma;
  logger: Logger;
  guildId: string;
  config: TConfig;
  manifest: PluginManifest;
  onCommunityAction?: (metric: string, userId: string) => Promise<void>;
}

/** Guild と Plugin に紐づいたコンテキストを生成する */
export function createPluginContext<TConfig, TClient, TPrisma>(
  options: CreatePluginContextOptions<TConfig, TClient, TPrisma>,
): PluginRuntimeContext<TConfig, TClient, TPrisma> {
  return {
    ...options,
    logger: options.logger.child({
      pluginId: options.manifest.id,
      guildId: options.guildId,
    }),
  };
}
