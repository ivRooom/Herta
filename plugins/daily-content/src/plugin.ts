import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import { dailyContentManifest } from './manifest.js';

/** Daily Content Plugin */
export class DailyContentPlugin extends BasePlugin {
  readonly manifest = dailyContentManifest;

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
