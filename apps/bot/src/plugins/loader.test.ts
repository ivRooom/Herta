import { describe, expect, it, vi } from 'vitest';
import type { EnabledPlugin } from '@herta/plugin-catalog';
import type { Logger } from '@herta/logger';
import type { SlashCommand } from '../commands/registry.js';
import { InMemoryGuildPluginCache } from './cache.js';
import { GuildPluginLoader } from './loader.js';
import { PluginRuntimeRegistry } from './registry.js';

const logger = {
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function enabled(pluginId: string, config: Record<string, unknown> = {}): EnabledPlugin {
  return {
    manifest: { id: pluginId } as EnabledPlugin['manifest'],
    config,
    configVersion: 1,
  };
}

function command(name: string): SlashCommand {
  return {
    definition: { name, description: name },
    execute: vi.fn(async () => undefined),
  };
}

describe('GuildPluginLoader', () => {
  it('有効Pluginだけをロードする', async () => {
    const registry = new PluginRuntimeRegistry([
      { pluginId: 'enabled', provideCommands: () => [command('enabled')] },
      { pluginId: 'disabled', provideCommands: () => [command('disabled')] },
    ]);
    const loader = new GuildPluginLoader({
      registry,
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('enabled')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual(['enabled']);
    expect(result.commands.map((item) => item.definition.name)).toEqual(['enabled']);
  });

  it('未知Pluginを警告してスキップする', async () => {
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('unknown')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual([]);
    expect(result.skipped).toEqual([
      { pluginId: 'unknown', reason: 'Registry に登録されていません' },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      { guildId: 'guild-a', pluginId: 'unknown' },
      '未登録Pluginをスキップ',
    );
  });

  it('command名の重複時は後続Plugin全体を有効化せずスキップする', async () => {
    const onEnable = vi.fn(async () => undefined);
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        { pluginId: 'first', provideCommands: () => [command('same')] },
        {
          pluginId: 'second',
          provideCommands: () => [command('same'), command('other')],
          onEnable,
        },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('first'), enabled('second')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual(['first']);
    expect(result.commands.map((item) => item.definition.name)).toEqual(['same']);
    expect(result.skipped[0]?.pluginId).toBe('second');
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('同一Plugin内のcommand名重複を検出して有効化しない', async () => {
    const onEnable = vi.fn(async () => undefined);
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'duplicated',
          provideCommands: () => [command('same'), command('same')],
          onEnable,
        },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('duplicated')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual([]);
    expect(result.commands).toEqual([]);
    expect(result.skipped[0]).toEqual({
      pluginId: 'duplicated',
      reason: 'command名 "same" が重複しています',
    });
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('cache invalidate後に設定変更を反映する', async () => {
    const cache = new InMemoryGuildPluginCache();
    let current = [enabled('plugin', { value: 'old' })];
    const provideCommands = vi.fn((config: Record<string, unknown>) => [
      command(String(config['value'])),
    ]);
    const fetch = vi.fn(async () => current);
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([{ pluginId: 'plugin', provideCommands }]),
      cache,
      logger,
      fetchEnabledPlugins: fetch,
    });

    await loader.loadGuildPlugins('guild-a');
    current = [enabled('plugin', { value: 'new' })];
    expect((await loader.loadGuildPlugins('guild-a')).commands[0]?.definition.name).toBe('old');
    cache.invalidate('guild-a');
    expect((await loader.loadGuildPlugins('guild-a')).commands[0]?.definition.name).toBe('new');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('Guildごとにcacheを分離する', async () => {
    const cache = new InMemoryGuildPluginCache();
    const fetch = vi.fn(async (guildId: string) => [enabled(guildId)]);
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        { pluginId: 'guild-a', provideCommands: () => [command('a')] },
        { pluginId: 'guild-b', provideCommands: () => [command('b')] },
      ]),
      cache,
      logger,
      fetchEnabledPlugins: fetch,
    });

    await loader.loadGuildPlugins('guild-a');
    const result = await loader.loadGuildPlugins('guild-b');

    expect(result.loaded).toEqual(['guild-b']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('Plugin providerの障害を隔離する', async () => {
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'broken',
          provideCommands: () => {
            throw new Error('broken');
          },
        },
        { pluginId: 'healthy', provideCommands: () => [command('healthy')] },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('broken'), enabled('healthy')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual(['healthy']);
    expect(result.commands[0]?.definition.name).toBe('healthy');
    expect(logger.error).toHaveBeenCalled();
  });

  it('cache失効だけではonEnableを再実行せず、明示的な無効化後に再実行する', async () => {
    const onEnable = vi.fn(async () => undefined);
    const onDisable = vi.fn(async () => undefined);
    const cache = new InMemoryGuildPluginCache();
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'lifecycle',
          provideCommands: () => [command('lifecycle')],
          onEnable,
          onDisable,
        },
      ]),
      cache,
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('lifecycle')]),
    });

    await loader.loadGuildPlugins('guild-a');
    await loader.loadGuildPlugins('guild-a');
    expect(onEnable).toHaveBeenCalledTimes(1);

    cache.invalidate('guild-a');
    await loader.loadGuildPlugins('guild-a');
    expect(onEnable).toHaveBeenCalledTimes(1);

    await loader.disableGuildPlugins('guild-a');
    expect(onDisable).toHaveBeenCalledTimes(1);
    await loader.loadGuildPlugins('guild-a');
    expect(onEnable).toHaveBeenCalledTimes(2);
  });
});
