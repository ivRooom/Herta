import type { PluginManifest } from '@herta/shared';
import type { PluginContext } from '../context/plugin-context.js';

export abstract class BasePlugin {
  abstract readonly manifest: PluginManifest;

  /** Plugin がシステムにロードされたとき */
  abstract onLoad(context: PluginContext): Promise<void>;

  /** Plugin が特定の Guild で有効化されたとき */
  abstract onEnable(guildId: string, config: unknown): Promise<void>;

  /** Plugin が特定の Guild で無効化されたとき */
  abstract onDisable(guildId: string): Promise<void>;

  /** Plugin がシステムからアンロードされたとき */
  abstract onUnload(): Promise<void>;

  /** Plugin の設定が変更されたとき (オプション) */
  onConfigChange?(guildId: string, oldConfig: unknown, newConfig: unknown): Promise<void>;
}
