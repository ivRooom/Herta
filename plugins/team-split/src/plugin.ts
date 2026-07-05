import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import type { PluginManifest } from '@herta/shared';

/** Team Split Plugin */
export class TeamSplitPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'team-split',
    name: 'Team Split',
    version: '1.0.0',
    description: 'ランダムチーム分け',
    author: { name: 'Herta' },
    category: 'game',
    permissions: [
      {
        id: 'team-split.manage',
        name: 'Team Split 管理',
        description: 'チーム分け設定の管理',
      },
    ],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [{ name: 'team', description: 'チーム分け' }],
  };

  private ctx!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.ctx = context;
    this.ctx.logger.info('TeamSplitPlugin をロードしました');
  }

  async onEnable(guildId: string, _config: unknown): Promise<void> {
    this.ctx.logger.info({ guildId }, 'TeamSplit を有効化');
  }

  async onDisable(guildId: string): Promise<void> {
    this.ctx.logger.info({ guildId }, 'TeamSplit を無効化');
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info('TeamSplitPlugin をアンロード');
  }
}
