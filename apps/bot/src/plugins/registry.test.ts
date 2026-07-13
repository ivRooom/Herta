import { describe, expect, it, vi } from 'vitest';
import { createPluginContext, definePlugin } from '@herta/plugin-sdk';
import {
  toRuntimePluginEntry,
  validatePluginInterface,
  PluginRuntimeRegistry,
} from './registry.js';
import { InMemoryGuildPluginCache } from './cache.js';
import { GuildPluginLoader } from './loader.js';

const manifest = {
  id: 'sample-plugin',
  name: 'Sample',
  version: '1.0.0',
  description: 'test',
  author: { name: 'test' },
  category: 'utility' as const,
  permissions: [],
  dependencies: [],
  configSchema: {},
  events: [],
  commands: [{ name: 'sample-ping', description: 'test' }],
};

describe('Plugin SDK interface', () => {
  it('有効な Plugin を検証できる', () => {
    const plugin = definePlugin({ manifest });
    expect(validatePluginInterface(plugin)).toEqual([]);
  });

  it('不正な manifest と command を検出する', () => {
    const violations = validatePluginInterface({
      manifest: {
        ...manifest,
        id: 'Invalid ID',
        commands: [{ name: 'Bad Name', description: 'x' }],
      },
      onEnable: 'invalid',
    });
    expect(violations.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        'manifest.id は kebab-case で指定してください',
        'command名 "Bad Name" が不正です',
        'onEnable は関数で指定してください',
      ]),
    );
  });

  it('重複した Plugin ID を検出する', () => {
    const registry = new PluginRuntimeRegistry([
      { pluginId: 'sample-plugin' },
      { pluginId: 'sample-plugin' },
    ]);
    expect(registry.validateAll().map(({ reason }) => reason)).toContain(
      'plugin id が重複しています',
    );
  });
});

describe('Plugin Runtime Context', () => {
  it('Guild と Plugin の情報を含み child logger を作成する', () => {
    const child = vi.fn(() => ({ child }));
    const logger = { child } as never;
    const context = createPluginContext({
      client: 'client',
      prisma: 'prisma',
      logger,
      guildId: 'guild-1',
      config: { greeting: 'hello' },
      manifest,
    });
    expect(context).toMatchObject({
      client: 'client',
      prisma: 'prisma',
      guildId: 'guild-1',
      config: { greeting: 'hello' },
    });
    expect(child).toHaveBeenCalledWith({ pluginId: 'sample-plugin', guildId: 'guild-1' });
  });

  it('SDK Plugin の lifecycle と provider を Runtime に接続する', async () => {
    const onEnable = vi.fn(async () => undefined);
    const onDisable = vi.fn(async () => undefined);
    const plugin = definePlugin({
      manifest,
      onEnable,
      onDisable,
      provideCommands: () => [{ definition: manifest.commands[0]!, execute: vi.fn() }],
    });
    const entry = toRuntimePluginEntry(plugin, (_plugin, guildId, config) =>
      createPluginContext({
        client: 'client',
        prisma: 'prisma',
        logger: { child: vi.fn(() => ({ child: vi.fn() })) } as never,
        guildId,
        config,
        manifest,
      }),
    );
    const command = entry.provideCommands?.({}, 'guild-1');
    await entry.onEnable?.('guild-1', {});
    await entry.onDisable?.('guild-1', {});
    expect(command).toHaveLength(1);
    expect(onEnable).toHaveBeenCalled();
    expect(onDisable).toHaveBeenCalled();
  });

  it('GuildPluginLoader で SDK Plugin をロードする', async () => {
    const plugin = definePlugin({
      manifest,
      provideCommands: () => [{ definition: manifest.commands[0]!, execute: vi.fn() }],
    });
    const entry = toRuntimePluginEntry(plugin, (_plugin, guildId, config) =>
      createPluginContext({
        client: 'client',
        prisma: 'prisma',
        logger: { child: vi.fn(() => ({ child: vi.fn() })) } as never,
        guildId,
        config,
        manifest,
      }),
    );
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([entry]),
      cache: new InMemoryGuildPluginCache(),
      logger: { warn: vi.fn(), error: vi.fn() } as never,
      fetchEnabledPlugins: async () => [{ manifest, config: {}, configVersion: 1 }],
    });
    const result = await loader.loadGuildPlugins('guild-1');
    expect(result.loaded).toEqual(['sample-plugin']);
    expect(result.commands).toHaveLength(1);
  });
});
