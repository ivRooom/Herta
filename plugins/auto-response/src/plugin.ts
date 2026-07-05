import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import type { PluginManifest } from '@herta/shared';

/** 自動応答 Plugin */
export class AutoResponsePlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'auto-response',
    name: 'Auto Response',
    version: '1.0.0',
    description: 'キーワード・正規表現に基づく自動応答',
    author: { name: 'Herta' },
    category: 'utility',
    permissions: [
      {
        id: 'auto-response.manage',
        name: 'Auto Response 管理',
        description: '自動応答ルールの追加・編集・削除',
      },
    ],
    dependencies: [],
    configSchema: {
      type: 'object',
      properties: {
        maxResponses: { type: 'number', default: 50 },
        cooldownMs: { type: 'number', default: 3000 },
      },
    },
    events: ['messageCreate'],
    commands: [{ name: 'autoresponse', description: '自動応答の管理' }],
  };

  private ctx!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.ctx = context;
    this.ctx.logger.info('AutoResponsePlugin をロードしました');
  }

  async onEnable(guildId: string, _config: unknown): Promise<void> {
    this.ctx.logger.info({ guildId }, 'AutoResponse を有効化');
  }

  async onDisable(guildId: string): Promise<void> {
    this.ctx.logger.info({ guildId }, 'AutoResponse を無効化');
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info('AutoResponsePlugin をアンロード');
  }
}
