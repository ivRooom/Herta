import type { PluginManifest } from '@herta/shared';
import type { CommandHandler } from './command/command-provider.js';
import type { PluginContext } from './context/plugin-context.js';
import type { PluginRuntimeContext } from './context/runtime-context.js';

/** Plugin が提供する Discord イベント */
export interface PluginEventHandler<TConfig, TClient = unknown, TPrisma = unknown> {
  event: string;
  handler: (
    context: PluginRuntimeContext<TConfig, TClient, TPrisma>,
    ...args: unknown[]
  ) => Promise<void>;
}

/** Herta Plugin の標準インターフェース */
export interface HertaPlugin<
  TConfig = Record<string, unknown>,
  TClient = unknown,
  TPrisma = unknown,
> {
  readonly manifest: PluginManifest;
  onLoad?(context: PluginContext): Promise<void>;
  onEnable?(context: PluginRuntimeContext<TConfig, TClient, TPrisma>): Promise<void>;
  onDisable?(context: PluginRuntimeContext<TConfig, TClient, TPrisma>): Promise<void>;
  onUnload?(): Promise<void>;
  onConfigChange?(
    context: PluginRuntimeContext<TConfig, TClient, TPrisma>,
    oldConfig: TConfig,
    newConfig: TConfig,
  ): Promise<void>;
  provideCommands?(context: PluginRuntimeContext<TConfig, TClient, TPrisma>): CommandHandler[];
  provideEvents?(
    context: PluginRuntimeContext<TConfig, TClient, TPrisma>,
  ): PluginEventHandler<TConfig, TClient, TPrisma>[];
}

/** Plugin 定義に型推論を適用する */
export function definePlugin<TConfig, TClient = unknown, TPrisma = unknown>(
  plugin: HertaPlugin<TConfig, TClient, TPrisma>,
): HertaPlugin<TConfig, TClient, TPrisma> {
  return plugin;
}
