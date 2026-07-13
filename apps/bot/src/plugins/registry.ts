import { getAllPluginManifests, getPluginManifest } from '@herta/plugin-catalog';
import type { Logger } from '@herta/logger';
import type { RuntimePluginEntry } from './types.js';

export type { GuildEventHandler, RuntimePluginEntry } from './types.js';

export class PluginRuntimeRegistry {
  private readonly entries = new Map<string, RuntimePluginEntry>();

  constructor(entries: RuntimePluginEntry[]) {
    for (const entry of entries) {
      this.entries.set(entry.pluginId, entry);
    }
  }

  get(pluginId: string): RuntimePluginEntry | undefined {
    return this.entries.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.entries.has(pluginId);
  }

  getAll(): RuntimePluginEntry[] {
    return [...this.entries.values()];
  }

  validateAgainstCatalog(logger?: Logger): { pluginId: string; reason: string }[] {
    const catalogIds = new Set(getAllPluginManifests().map((manifest) => manifest.id));
    const mismatches: { pluginId: string; reason: string }[] = [];
    for (const entry of this.entries.values()) {
      if (catalogIds.has(entry.pluginId)) {
        continue;
      }
      const reason = 'Plugin catalog manifest が見つかりません';
      mismatches.push({ pluginId: entry.pluginId, reason });
      logger?.warn({ pluginId: entry.pluginId, reason }, 'Plugin Registry と catalog が不整合です');
    }
    return mismatches;
  }
}

const officialPluginIds = [
  'auto-response',
  'daily-content',
  'lfg',
  'moderation',
  'quote',
  'team-split',
] as const;

// 実装を追加する際は、ここへ静的な command/event provider を登録する。
const officialEntries: RuntimePluginEntry[] = officialPluginIds.flatMap((pluginId) => {
  // Manifest を参照して ID の typo を早期に検出し、実行コードは動的に読み込まない。
  return getPluginManifest(pluginId) ? [{ pluginId }] : [];
});

export const defaultPluginRegistry = new PluginRuntimeRegistry(officialEntries);
