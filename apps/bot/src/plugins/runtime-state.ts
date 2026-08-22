import type { PluginRuntimeEvent } from '@herta/shared';

export class PluginRuntimeState {
  private readonly appliedVersions = new Map<string, number>();

  markActive(guildId: string, pluginId: string, configVersion: number): void {
    this.appliedVersions.set(this.key(guildId, pluginId), configVersion);
  }

  markInactive(guildId: string, pluginId: string): void {
    this.appliedVersions.delete(this.key(guildId, pluginId));
  }

  clearGuild(guildId: string): void {
    const prefix = `${guildId}:`;
    for (const key of this.appliedVersions.keys()) {
      if (key.startsWith(prefix)) this.appliedVersions.delete(key);
    }
  }

  isEventApplied(event: PluginRuntimeEvent): boolean {
    const appliedVersion = this.appliedVersions.get(this.key(event.guildId, event.pluginId));
    if (event.eventType === 'disabled') return appliedVersion === undefined;
    return appliedVersion === event.configVersion;
  }

  private key(guildId: string, pluginId: string): string {
    return `${guildId}:${pluginId}`;
  }
}

export const defaultPluginRuntimeState = new PluginRuntimeState();
