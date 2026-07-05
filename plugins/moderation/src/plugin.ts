import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import type { PluginManifest } from '@herta/shared';

/** モデレーション Plugin */
export class ModerationPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'moderation',
    name: 'Moderation',
    version: '1.0.0',
    description: 'NGワードフィルター、スパム検知、招待リンク管理',
    author: { name: 'Herta' },
    category: 'moderation',
    permissions: [
      {
        id: 'moderation.manage',
        name: 'Moderation 管理',
        description: 'モデレーション設定の管理',
      },
    ],
    dependencies: [],
    configSchema: {},
    events: ['messageCreate', 'messageUpdate'],
    commands: [{ name: 'mod', description: 'モデレーション管理' }],
  };

  private ctx!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.ctx = context;
    this.ctx.logger.info('ModerationPlugin をロードしました');
  }

  async onEnable(guildId: string, _config: unknown): Promise<void> {
    this.ctx.logger.info({ guildId }, 'Moderation を有効化');
  }

  async onDisable(guildId: string): Promise<void> {
    this.ctx.logger.info({ guildId }, 'Moderation を無効化');
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info('ModerationPlugin をアンロード');
  }
}
