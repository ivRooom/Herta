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

  it('同じversionのactive eventは一致時だけ適用済みになる', () => {
    const state = new PluginRuntimeState();
    state.markActive('guild-a', 'quote', 4);

    expect(
      state.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'quote',
          configVersion: 4,
          eventType: 'enabled',
        }),
      ),
    ).toBe(true);
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
