import type { Logger } from '@herta/logger';
import type { EnabledPlugin } from '@herta/plugin-catalog';
import type { SlashCommand } from '../commands/registry.js';
import type { GuildPluginCache } from './cache.js';
import type { PluginRuntimeRegistry } from './registry.js';
import { defaultPluginRuntimeState, type PluginRuntimeState } from './runtime-state.js';
import type { GuildEventHandler, LoadedGuildPlugins } from './types.js';

export interface GuildPluginLoaderDeps {
  registry: PluginRuntimeRegistry;
  cache: GuildPluginCache;
  logger: Logger;
  fetchEnabledPlugins(guildId: string): Promise<EnabledPlugin[]>;
  coreCommandNames?: string[];
  runtimeState?: PluginRuntimeState;
}

interface ActivatedPlugin {
  pluginId: string;
  config: Record<string, unknown>;
  configVersion: number;
}

export class GuildPluginLoader {
  private readonly registry: PluginRuntimeRegistry;
  private readonly cache: GuildPluginCache;
  private readonly logger: Logger;
  private readonly fetchEnabledPlugins: (guildId: string) => Promise<EnabledPlugin[]>;
  private readonly coreCommandNames: Set<string>;
  private readonly runtimeState: PluginRuntimeState;
  private readonly activatedPlugins = new Map<string, ActivatedPlugin>();

  constructor(deps: GuildPluginLoaderDeps) {
    this.registry = deps.registry;
    this.cache = deps.cache;
    this.logger = deps.logger;
    this.fetchEnabledPlugins = deps.fetchEnabledPlugins;
    this.coreCommandNames = new Set(deps.coreCommandNames ?? []);
    this.runtimeState = deps.runtimeState ?? defaultPluginRuntimeState;
  }

  private async getEnabled(guildId: string): Promise<EnabledPlugin[]> {
    const cached = this.cache.get(guildId);
    if (cached) {
      return cached;
    }

    try {
      const enabled = await this.fetchEnabledPlugins(guildId);
      this.cache.set(guildId, enabled);
      return enabled;
    } catch (error) {
      this.logger.error({ guildId, error }, '有効Pluginの取得に失敗しました');
      return [];
    }
  }

  async getGuildPluginConfig(
    guildId: string,
    pluginId: string,
  ): Promise<Record<string, unknown> | null> {
    const enabled = (await this.getEnabled(guildId)).find((item) => item.manifest.id === pluginId);
    return enabled ? structuredClone(enabled.config) : null;
  }

  async loadGuildPlugins(guildId: string): Promise<LoadedGuildPlugins> {
    const commands: SlashCommand[] = [];
    const events: GuildEventHandler[] = [];
    const loaded: string[] = [];
    const skipped: { pluginId: string; reason: string }[] = [];
    const commandNames = new Set(this.coreCommandNames);

    for (const enabled of await this.getEnabled(guildId)) {
      const pluginId = enabled.manifest.id;
      const entry = this.registry.get(pluginId);
      if (!entry) {
        const reason = 'Registry に登録されていません';
        this.logger.warn({ guildId, pluginId }, '未登録Pluginをスキップ');
        skipped.push({ pluginId, reason });
        continue;
      }

      let pluginCommands: SlashCommand[] = [];
      let pluginEvents: GuildEventHandler[] = [];
      try {
        pluginCommands = entry.provideCommands?.(enabled.config, guildId) ?? [];
        pluginEvents = entry.provideEvents?.(enabled.config, guildId) ?? [];
      } catch (error) {
        const reason = 'Plugin provider の実行に失敗しました';
        this.logger.error({ guildId, pluginId, error }, 'Pluginのロードに失敗しました');
        skipped.push({ pluginId, reason });
        continue;
      }

      const duplicateCommandName = this.findDuplicateCommandName(pluginCommands, commandNames);
      if (duplicateCommandName) {
        const reason = `command名 "${duplicateCommandName}" が重複しています`;
        this.logger.warn(
          { guildId, pluginId, commandName: duplicateCommandName },
          'command名が重複するためPluginを無効化',
        );
        skipped.push({ pluginId, reason });
        continue;
      }

      const activationKey = this.activationKey(guildId, pluginId);
      if (!this.activatedPlugins.has(activationKey)) {
        try {
          await entry.onEnable?.(guildId, enabled.config);
          this.activatedPlugins.set(activationKey, {
            pluginId,
            config: structuredClone(enabled.config),
            configVersion: enabled.configVersion,
          });
          this.runtimeState.markActive(guildId, pluginId, enabled.configVersion);
        } catch (error) {
          const reason = 'Plugin onEnable の実行に失敗しました';
          this.logger.error({ guildId, pluginId, error }, 'Pluginの有効化に失敗しました');
          skipped.push({ pluginId, reason });
          continue;
        }
      }

      commands.push(...pluginCommands);
      events.push(...pluginEvents);
      for (const command of pluginCommands) {
        commandNames.add(command.definition.name);
      }
      loaded.push(pluginId);
    }

    return { commands, events, loaded, skipped };
  }

  async getGuildCommands(guildId: string): Promise<SlashCommand[]> {
    return (await this.loadGuildPlugins(guildId)).commands;
  }

  async getGuildEvents(guildId: string): Promise<GuildEventHandler[]> {
    return (await this.loadGuildPlugins(guildId)).events;
  }

  /** Guild の有効化済みPluginを無効化し、SDKのlifecycleを通知する。 */
  async disableGuildPlugins(guildId: string): Promise<void> {
    const prefix = `${guildId}:`;
    const activated = [...this.activatedPlugins.entries()].filter(([key]) =>
      key.startsWith(prefix),
    );

    for (const [activationKey, state] of activated) {
      const entry = this.registry.get(state.pluginId);
      try {
        await entry?.onDisable?.(guildId, state.config);
        this.activatedPlugins.delete(activationKey);
        this.runtimeState.markInactive(guildId, state.pluginId);
      } catch (error) {
        this.logger.error(
          { guildId, pluginId: state.pluginId, error },
          'Plugin の無効化に失敗しました',
        );
      }
    }
  }

  private findDuplicateCommandName(
    pluginCommands: SlashCommand[],
    registeredCommandNames: Set<string>,
  ): string | undefined {
    const localCommandNames = new Set<string>();
    for (const command of pluginCommands) {
      const name = command.definition.name;
      if (registeredCommandNames.has(name) || localCommandNames.has(name)) {
        return name;
      }
      localCommandNames.add(name);
    }
    return undefined;
  }

  private activationKey(guildId: string, pluginId: string): string {
    return `${guildId}:${pluginId}`;
  }
}
