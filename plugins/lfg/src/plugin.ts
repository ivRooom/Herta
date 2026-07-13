import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import { lfgManifest } from './manifest.js';

/** LFG (Looking For Group) Plugin */
export class LfgPlugin extends BasePlugin {
  readonly manifest = lfgManifest;

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
