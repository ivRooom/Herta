import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import { autoResponseManifest } from './manifest.js';

/** 自動応答 Plugin */
export class AutoResponsePlugin extends BasePlugin {
  readonly manifest = autoResponseManifest;

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
