import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import type { PluginManifest } from '@herta/shared';

/** Daily Content Plugin */
export class DailyContentPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'daily-content',
    name: 'Daily Content',
    version: '1.0.0',
    description: '毎日の定時メッセージ送信',
    author: { name: 'Herta' },
    category: 'utility',
    permissions: [
      {
        id: 'daily-content.manage',
        name: 'Daily Content 管理',
        description: '定時メッセージの設定',
      },
    ],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [{ name: 'daily', description: '定時メッセージの管理' }],
  };

  private ctx!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.ctx = context;
    this.ctx.logger.info('DailyContentPlugin をロードしました');
  }

  async onEnable(guildId: string, _config: unknown): Promise<void> {
    this.ctx.logger.info({ guildId }, 'DailyContent を有効化');
  }

  async onDisable(guildId: string): Promise<void> {
    this.ctx.logger.info({ guildId }, 'DailyContent を無効化');
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info('DailyContentPlugin をアンロード');
  }
}
