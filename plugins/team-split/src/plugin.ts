import { BasePlugin } from '@herta/plugin-sdk';
import type { PluginContext } from '@herta/plugin-sdk';
import { teamSplitManifest } from './manifest.js';

/** Team Split Plugin */
export class TeamSplitPlugin extends BasePlugin {
  readonly manifest = teamSplitManifest;

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
