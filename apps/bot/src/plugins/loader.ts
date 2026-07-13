import type { Logger } from '@herta/logger';
import type { EnabledPlugin } from '@herta/plugin-catalog';
import type { SlashCommand } from '../commands/registry.js';
import type { GuildPluginCache } from './cache.js';
import type { PluginRuntimeRegistry } from './registry.js';
import type { GuildEventHandler, LoadedGuildPlugins } from './types.js';

export interface GuildPluginLoaderDeps {
  registry: PluginRuntimeRegistry;
  cache: GuildPluginCache;
  logger: Logger;
  fetchEnabledPlugins(guildId: string): Promise<EnabledPlugin[]>;
  coreCommandNames?: string[];
}

export class GuildPluginLoader {
  private readonly registry: PluginRuntimeRegistry;
  private readonly cache: GuildPluginCache;
  private readonly logger: Logger;
  private readonly fetchEnabledPlugins: (guildId: string) => Promise<EnabledPlugin[]>;
  private readonly coreCommandNames: Set<string>;
  private readonly activatedPlugins = new Set<string>();

  constructor(deps: GuildPluginLoaderDeps) {
    this.registry = deps.registry;
    this.cache = deps.cache;
    this.logger = deps.logger;
    this.fetchEnabledPlugins = deps.fetchEnabledPlugins;
    this.coreCommandNames = new Set(deps.coreCommandNames ?? []);
  }

  private async getEnabled(guildId: string): Promise<EnabledPlugin[]> {
    const cached = this.cache.get(guildId);
    if (cached) {
      return cached;
    }
    this.clearActivation(guildId);
    try {
      const enabled = await this.fetchEnabledPlugins(guildId);
      this.cache.set(guildId, enabled);
      return enabled;
    } catch (error) {
      this.logger.error({ guildId, error }, '有効Pluginの取得に失敗しました');
      return [];
    }
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
        const activationKey = this.activationKey(guildId, pluginId);
        if (!this.activatedPlugins.has(activationKey)) {
          await entry.onEnable?.(guildId, enabled.config);
          this.activatedPlugins.add(activationKey);
        }
      } catch (error) {
        const reason = 'Plugin provider の実行に失敗しました';
        this.logger.error({ guildId, pluginId, error }, 'Pluginのロードに失敗しました');
        skipped.push({ pluginId, reason });
        continue;
      }

      const duplicate = pluginCommands.find((command) => commandNames.has(command.definition.name));
      if (duplicate) {
        const commandName = duplicate.definition.name;
        const reason = `command名 "${commandName}" が重複しています`;
        this.logger.warn(
          { guildId, pluginId, commandName },
          'command名が重複するためPluginを無効化',
        );
        skipped.push({ pluginId, reason });
        continue;
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

  /** Guild の Plugin を無効化し、SDK のライフサイクルを通知する */
  async disableGuildPlugins(guildId: string): Promise<void> {
    for (const enabled of await this.getEnabled(guildId)) {
      const entry = this.registry.get(enabled.manifest.id);
      if (!entry) {
        this.activatedPlugins.delete(this.activationKey(guildId, enabled.manifest.id));
        continue;
      }
      try {
        if (entry.onDisable) {
          await entry.onDisable(guildId, enabled.config);
        }
      } catch (error) {
        this.logger.error(
          { guildId, pluginId: enabled.manifest.id, error },
          'Plugin の無効化に失敗しました',
        );
      } finally {
        this.activatedPlugins.delete(this.activationKey(guildId, enabled.manifest.id));
      }
    }
    this.clearActivation(guildId);
  }

  private activationKey(guildId: string, pluginId: string): string {
    return `${guildId}:${pluginId}`;
  }

  private clearActivation(guildId: string): void {
    const prefix = `${guildId}:`;
    for (const key of this.activatedPlugins) {
      if (key.startsWith(prefix)) {
        this.activatedPlugins.delete(key);
      }
    }
  }
}
