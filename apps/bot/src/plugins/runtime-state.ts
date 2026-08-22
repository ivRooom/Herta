import type { PluginRuntimeEvent } from '@herta/shared';

export class PluginRuntimeState {
  private readonly appliedVersions = new Map<string, number>();
  private readonly configurationLoadedGuilds = new Set<string>();

  markActive(guildId: string, pluginId: string, configVersion: number): void {
    this.appliedVersions.set(this.key(guildId, pluginId), configVersion);
  }

  markInactive(guildId: string, pluginId: string): void {
    this.appliedVersions.delete(this.key(guildId, pluginId));
  }

  markReloadStarted(guildId: string): void {
    this.configurationLoadedGuilds.delete(guildId);
  }

  markConfigurationLoaded(guildId: string): void {
    this.configurationLoadedGuilds.add(guildId);
  }

  markConfigurationLoadFailed(guildId: string): void {
    this.configurationLoadedGuilds.delete(guildId);
  }

  clearGuild(guildId: string): void {
    const prefix = `${guildId}:`;
    for (const key of this.appliedVersions.keys()) {
      if (key.startsWith(prefix)) this.appliedVersions.delete(key);
    }
    this.configurationLoadedGuilds.delete(guildId);
  }

  isEventApplied(event: PluginRuntimeEvent): boolean {
    const appliedVersion = this.appliedVersions.get(this.key(event.guildId, event.pluginId));

    if (appliedVersion !== undefined && appliedVersion > event.configVersion) return true;
    if (event.eventType === 'disabled') {
      return this.configurationLoadedGuilds.has(event.guildId) && appliedVersion === undefined;
    }
    return appliedVersion === event.configVersion;
  }

  private key(guildId: string, pluginId: string): string {
    return `${guildId}:${pluginId}`;
  }
}

export const defaultPluginRuntimeState = new PluginRuntimeState();
