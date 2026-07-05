import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import type { PluginManifest } from '@herta/shared';

/** LFG (Looking For Group) Plugin */
export class LfgPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'lfg',
    name: 'LFG',
    version: '1.0.0',
    description: 'メンバー募集 (Looking For Group)',
    author: { name: 'Herta' },
    category: 'game',
    permissions: [
      {
        id: 'lfg.manage',
        name: 'LFG 管理',
        description: 'LFG 設定の管理',
      },
    ],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [{ name: 'lfg', description: 'メンバー募集' }],
  };

  private ctx!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.ctx = context;
    this.ctx.logger.info('LfgPlugin をロードしました');
  }

  async onEnable(guildId: string, _config: unknown): Promise<void> {
    this.ctx.logger.info({ guildId }, 'LFG を有効化');
  }

  async onDisable(guildId: string): Promise<void> {
    this.ctx.logger.info({ guildId }, 'LFG を無効化');
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info('LfgPlugin をアンロード');
  }
}
