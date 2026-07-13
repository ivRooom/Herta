import { getAllPluginManifests, getPluginManifest } from '@herta/plugin-catalog';
import type { Logger } from '@herta/logger';
import type { HertaPlugin } from '@herta/plugin-sdk';
import type { SlashCommand } from '../commands/registry.js';
import type { RuntimePluginEntry } from './types.js';

export type { GuildEventHandler, RuntimePluginEntry } from './types.js';

export interface PluginInterfaceViolation {
  pluginId: string;
  reason: string;
}

const pluginIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const commandNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,31})$/;

/** SDK Plugin の実装が Runtime で扱える形か検証する */
export function validatePluginInterface(
  plugin: unknown,
  seenPluginIds: Set<string> = new Set(),
): PluginInterfaceViolation[] {
  const candidate = plugin as Partial<HertaPlugin> | null;
  const manifest = candidate?.manifest;
  const pluginId =
    typeof manifest?.id === 'string'
      ? manifest.id
      : typeof plugin === 'object'
        ? 'unknown'
        : 'invalid';
  const violations: PluginInterfaceViolation[] = [];
  const add = (reason: string) => violations.push({ pluginId, reason });

  if (!manifest || typeof manifest !== 'object') {
    add('manifest がありません');
    return violations;
  }
  if (!pluginIdPattern.test(manifest.id)) add('manifest.id は kebab-case で指定してください');
  if (!manifest.name || typeof manifest.name !== 'string') add('manifest.name が不正です');
  if (!manifest.version || typeof manifest.version !== 'string') add('manifest.version が不正です');
  if (!manifest.description || typeof manifest.description !== 'string')
    add('manifest.description が不正です');
  if (!manifest.author || typeof manifest.author !== 'object') add('manifest.author が不正です');
  if (!Array.isArray(manifest.permissions)) add('manifest.permissions が不正です');
  if (!Array.isArray(manifest.dependencies)) add('manifest.dependencies が不正です');
  if (!manifest.configSchema || typeof manifest.configSchema !== 'object')
    add('manifest.configSchema が不正です');
  if (!Array.isArray(manifest.events)) add('manifest.events が不正です');
  if (!Array.isArray(manifest.commands)) {
    add('manifest.commands が不正です');
    return violations;
  }
  if (seenPluginIds.has(manifest.id)) add('plugin id が重複しています');
  seenPluginIds.add(manifest.id);

  for (const hook of [
    'onLoad',
    'onEnable',
    'onDisable',
    'onUnload',
    'onConfigChange',
    'provideCommands',
    'provideEvents',
  ]) {
    if (
      candidate?.[hook as keyof HertaPlugin] !== undefined &&
      typeof candidate[hook as keyof HertaPlugin] !== 'function'
    ) {
      add(`${hook} は関数で指定してください`);
    }
  }
  for (const command of manifest.commands ?? []) {
    if (!commandNamePattern.test(command.name)) add(`command名 "${command.name}" が不正です`);
  }
  return violations;
}

/** SDK Plugin を Runtime Registry の静的 Entry に変換する */
export function toRuntimePluginEntry<TConfig, TClient = unknown, TPrisma = unknown>(
  plugin: HertaPlugin<TConfig, TClient, TPrisma>,
  createContext: (
    plugin: HertaPlugin<TConfig, TClient, TPrisma>,
    guildId: string,
    config: TConfig,
  ) => Parameters<NonNullable<HertaPlugin<TConfig, TClient, TPrisma>['onEnable']>>[0],
): RuntimePluginEntry {
  const context = (guildId: string, config: Record<string, unknown>) =>
    createContext(plugin, guildId, config as TConfig);
  return {
    pluginId: plugin.manifest.id,
    plugin: plugin as unknown as HertaPlugin<Record<string, unknown>>,
    provideCommands: (config, guildId = '') =>
      (plugin.provideCommands?.(context(guildId, config)) ?? []) as SlashCommand[],
    provideEvents: (config, guildId = '') =>
      plugin.provideEvents?.(context(guildId, config)).map(({ event, handler }) => ({
        event,
        handler: (...args) => handler(context(guildId, config), ...args),
      })) ?? [],
    onEnable: async (guildId, config) => plugin.onEnable?.(context(guildId, config)),
    onDisable: async (guildId, config) => plugin.onDisable?.(context(guildId, config)),
  };
}

export class PluginRuntimeRegistry {
  private readonly entries = new Map<string, RuntimePluginEntry>();
  private readonly duplicatePluginIds = new Set<string>();
  private readonly invalidPluginIds = new Set<string>();

  constructor(entries: RuntimePluginEntry[]) {
    for (const entry of entries) {
      if (this.entries.has(entry.pluginId)) this.duplicatePluginIds.add(entry.pluginId);
      this.entries.set(entry.pluginId, entry);
    }
  }

  validateAll(logger?: Logger): PluginInterfaceViolation[] {
    const violations: PluginInterfaceViolation[] = [];
    const seen = new Set<string>();
    for (const pluginId of this.duplicatePluginIds) {
      const violation = { pluginId, reason: 'plugin id が重複しています' };
      violations.push(violation);
      this.invalidPluginIds.add(pluginId);
      logger?.warn(violation, 'Plugin Interface の検証に失敗しました');
    }
    for (const entry of this.entries.values()) {
      const entryViolations = entry.plugin
        ? validatePluginInterface(entry.plugin, seen)
        : validateRuntimeEntry(entry, seen);
      violations.push(...entryViolations);
      if (entryViolations.length > 0) this.invalidPluginIds.add(entry.pluginId);
      for (const violation of entryViolations) {
        logger?.warn(violation, 'Plugin Interface の検証に失敗しました');
      }
    }
    return violations;
  }

  get(pluginId: string): RuntimePluginEntry | undefined {
    if (this.invalidPluginIds.has(pluginId)) return undefined;
    return this.entries.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.get(pluginId) !== undefined;
  }

  getAll(): RuntimePluginEntry[] {
    return [...this.entries.keys()].flatMap((pluginId) => {
      const entry = this.get(pluginId);
      return entry ? [entry] : [];
    });
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

function validateRuntimeEntry(
  entry: RuntimePluginEntry,
  seenPluginIds: Set<string>,
): PluginInterfaceViolation[] {
  const violations: PluginInterfaceViolation[] = [];
  const add = (reason: string) => violations.push({ pluginId: entry.pluginId, reason });
  if (!pluginIdPattern.test(entry.pluginId)) add('pluginId は kebab-case で指定してください');
  if (seenPluginIds.has(entry.pluginId)) add('plugin id が重複しています');
  seenPluginIds.add(entry.pluginId);
  for (const hook of ['provideCommands', 'provideEvents', 'onEnable', 'onDisable']) {
    if (
      entry[hook as keyof RuntimePluginEntry] !== undefined &&
      typeof entry[hook as keyof RuntimePluginEntry] !== 'function'
    ) {
      add(`${hook} は関数で指定してください`);
    }
  }
  return violations;
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
