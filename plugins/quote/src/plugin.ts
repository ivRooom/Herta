import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import { quoteManifest } from './manifest.js';

/** 名言 Plugin */
export class QuotePlugin extends BasePlugin {
  readonly manifest = quoteManifest;

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
