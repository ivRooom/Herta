import { describe, expect, it } from 'vitest';
import { normalizeBirthdayRoleConfig } from './birthday-role.js';

const ASSET_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('Birthday Card background source config', () => {
  it('既存設定では組み込みpresetを既定値として維持する', () => {
    expect(normalizeBirthdayRoleConfig({}).birthdayCardBackgroundSource).toBe('preset');
  });

  it('legacy custom背景を後方互換で維持する', () => {
    expect(
      normalizeBirthdayRoleConfig({ birthdayCardBackgroundSource: 'custom' })
        .birthdayCardBackgroundSource,
    ).toBe('custom');
  });

  it('有効なGuild Assetだけasset背景として受理する', () => {
    const config = normalizeBirthdayRoleConfig({
      birthdayCardBackgroundSource: 'asset',
      birthdayCardAssetId: ASSET_ID,
    });
    expect(config.birthdayCardBackgroundSource).toBe('asset');
    expect(config.birthdayCardAssetId).toBe(ASSET_ID);
  });

  it('Asset ID不正値と外部URLは組み込みpresetへfallbackする', () => {
    expect(
      normalizeBirthdayRoleConfig({
        birthdayCardBackgroundSource: 'asset',
        birthdayCardAssetId: '../image.webp',
      }).birthdayCardBackgroundSource,
    ).toBe('preset');
    expect(
      normalizeBirthdayRoleConfig({ birthdayCardBackgroundSource: 'https://example.com/image.png' })
        .birthdayCardBackgroundSource,
    ).toBe('preset');
  });
});
