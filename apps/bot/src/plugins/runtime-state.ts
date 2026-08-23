import type { PluginRuntimeEvent } from '@herta/shared';

export interface PluginRuntimeTargetState {
  configVersion: number;
  eventType: PluginRuntimeEvent['eventType'];
}

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

  isTargetApplied(
    guildId: string,
    pluginId: string,
    configVersion: number,
    enabled: boolean,
  ): boolean {
    if (!this.configurationLoadedGuilds.has(guildId)) return false;
    const appliedVersion = this.appliedVersions.get(this.key(guildId, pluginId));
    return enabled ? appliedVersion === configVersion : appliedVersion === undefined;
  }

  isEventApplied(event: PluginRuntimeEvent, latestTarget?: PluginRuntimeTargetState): boolean {
    const appliedVersion = this.appliedVersions.get(this.key(event.guildId, event.pluginId));
    const configurationLoaded = this.configurationLoadedGuilds.has(event.guildId);

    if (!configurationLoaded) return false;

    if (latestTarget && latestTarget.configVersion > event.configVersion) {
      if (latestTarget.eventType === 'disabled') return appliedVersion === undefined;
      return appliedVersion !== undefined && appliedVersion >= latestTarget.configVersion;
    }

    if (appliedVersion !== undefined && appliedVersion > event.configVersion) return true;
    if (event.eventType === 'disabled') return appliedVersion === undefined;
    return appliedVersion === event.configVersion;
  }

  private key(guildId: string, pluginId: string): string {
    return `${guildId}:${pluginId}`;
  }
}

export const defaultPluginRuntimeState = new PluginRuntimeState();
