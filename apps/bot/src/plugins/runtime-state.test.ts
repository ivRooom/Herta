import { describe, expect, it } from 'vitest';
import { createPluginRuntimeEvent } from '@herta/shared';
import { PluginRuntimeState } from './runtime-state.js';

describe('PluginRuntimeState', () => {
  it('disable ACKはfreshな設定取得が完了した場合だけ成立する', () => {
    const state = new PluginRuntimeState();
    const event = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 2,
      eventType: 'disabled',
    });

    state.markReloadStarted('guild-a');
    state.markInactive('guild-a', 'quote');
    expect(state.isEventApplied(event)).toBe(false);

    state.markConfigurationLoaded('guild-a');
    expect(state.isEventApplied(event)).toBe(true);

    state.markConfigurationLoadFailed('guild-a');
    expect(state.isEventApplied(event)).toBe(false);
  });

  it('現在のRuntimeがより新しいversionなら旧eventをsupersededとして扱う', () => {
    const state = new PluginRuntimeState();
    state.markConfigurationLoaded('guild-a');
    state.markActive('guild-a', 'quote', 3);

    expect(
      state.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'quote',
          configVersion: 2,
          eventType: 'config_updated',
        }),
      ),
    ).toBe(true);
    expect(
      state.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'quote',
          configVersion: 2,
          eventType: 'disabled',
        }),
      ),
    ).toBe(true);
  });

  it('新しいdisableが適用済みなら待機中の旧enable eventをsupersededとして扱う', () => {
    const state = new PluginRuntimeState();
    const staleEnable = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 2,
      eventType: 'enabled',
    });
    const latestDisable = { configVersion: 3, eventType: 'disabled' as const };

    state.markReloadStarted('guild-a');
    state.markInactive('guild-a', 'quote');
    expect(state.isEventApplied(staleEnable, latestDisable)).toBe(false);

    state.markConfigurationLoaded('guild-a');
    expect(state.isEventApplied(staleEnable, latestDisable)).toBe(true);

    state.markConfigurationLoadFailed('guild-a');
    expect(state.isEventApplied(staleEnable, latestDisable)).toBe(false);
  });

  it('新しいenableはそのversionがactiveになった場合だけ旧eventをsupersedeする', () => {
    const state = new PluginRuntimeState();
    const staleEvent = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 2,
      eventType: 'config_updated',
    });
    const latestEnable = { configVersion: 3, eventType: 'enabled' as const };

    state.markConfigurationLoaded('guild-a');
    state.markInactive('guild-a', 'quote');
    expect(state.isEventApplied(staleEvent, latestEnable)).toBe(false);

    state.markActive('guild-a', 'quote', 3);
    expect(state.isEventApplied(staleEvent, latestEnable)).toBe(true);
  });

  it('DB再読込失敗後は以前のactive versionをACK根拠にしない', () => {
    const state = new PluginRuntimeState();
    const event = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 2,
      eventType: 'config_updated',
    });

    state.markConfigurationLoaded('guild-a');
    state.markActive('guild-a', 'quote', 3);
    expect(state.isEventApplied(event)).toBe(true);

    state.markReloadStarted('guild-a');
    expect(state.isEventApplied(event)).toBe(false);

    state.markConfigurationLoadFailed('guild-a');
    expect(state.isEventApplied(event)).toBe(false);
  });

  it('同じversionのactive eventはfreshな設定取得後の一致時だけ適用済みになる', () => {
    const state = new PluginRuntimeState();
    state.markActive('guild-a', 'quote', 4);
    const event = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 4,
      eventType: 'enabled',
    });

    expect(state.isEventApplied(event)).toBe(false);
    state.markConfigurationLoaded('guild-a');
    expect(state.isEventApplied(event)).toBe(true);
    expect(
      state.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'quote',
          configVersion: 5,
          eventType: 'config_updated',
        }),
      ),
    ).toBe(false);
  });
});
