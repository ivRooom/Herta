import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import type { PluginManifest } from '@herta/shared';

/** 名言 Plugin */
export class QuotePlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'quote',
    name: 'Quote',
    version: '1.0.0',
    description: '名言の登録・表示・管理',
    author: { name: 'Herta' },
    category: 'fun',
    permissions: [
      {
        id: 'quote.manage',
        name: 'Quote 管理',
        description: '名言の追加・編集・削除',
      },
    ],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [{ name: 'quote', description: '名言の管理' }],
  };

  private ctx!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.ctx = context;
    this.ctx.logger.info('QuotePlugin をロードしました');
  }

  async onEnable(guildId: string, _config: unknown): Promise<void> {
    this.ctx.logger.info({ guildId }, 'Quote を有効化');
  }

  async onDisable(guildId: string): Promise<void> {
    this.ctx.logger.info({ guildId }, 'Quote を無効化');
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info('QuotePlugin をアンロード');
  }
}
