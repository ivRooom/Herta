import { describe, expect, it } from 'vitest';
import { normalizeRuntimePluginConfig } from './index.js';

describe('normalizeRuntimePluginConfig', () => {
  it('Birthday Card Asset LibraryだけBot runtimeではlegacy custom pathへ適合させる', () => {
    const source = {
      birthdayCardBackgroundSource: 'asset',
      birthdayCardAssetId: '123e4567-e89b-42d3-a456-426614174000',
      birthdayCardEnabled: true,
    };

    const normalized = normalizeRuntimePluginConfig('birthday-role', source);

    expect(normalized).not.toBe(source);
    expect(normalized).toEqual({
      ...source,
      birthdayCardBackgroundSource: 'custom',
    });
    expect(source.birthdayCardBackgroundSource).toBe('asset');
  });

  it('Birthday Roleのpreset/customと他Plugin設定は変更しない', () => {
    const preset = { birthdayCardBackgroundSource: 'preset' };
    const moderation = { birthdayCardBackgroundSource: 'asset' };

    expect(normalizeRuntimePluginConfig('birthday-role', preset)).toBe(preset);
    expect(normalizeRuntimePluginConfig('moderation', moderation)).toBe(moderation);
  });
});
