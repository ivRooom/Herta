import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import { moderationManifest } from './manifest.js';

/** モデレーション Plugin */
export class ModerationPlugin extends BasePlugin {
  readonly manifest = moderationManifest;

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
