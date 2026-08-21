import { describe, expect, it } from 'vitest';
import { normalizeRuntimePluginConfig } from './index.js';

describe('normalizeRuntimePluginConfig', () => {
  it('Birthday Card Asset Libraryのasset discriminatorをruntimeでも保持する', () => {
    const source = {
      birthdayCardBackgroundSource: 'asset',
      birthdayCardAssetId: '123e4567-e89b-42d3-a456-426614174000',
      birthdayCardEnabled: true,
    };

    expect(normalizeRuntimePluginConfig('birthday-role', source)).toBe(source);
  });

  it('legacy customにAsset IDが残っていてもcustomとして保持する', () => {
    const source = {
      birthdayCardBackgroundSource: 'custom',
      birthdayCardAssetId: '123e4567-e89b-42d3-a456-426614174000',
    };

    expect(normalizeRuntimePluginConfig('birthday-role', source)).toBe(source);
    expect(source.birthdayCardBackgroundSource).toBe('custom');
  });
});
