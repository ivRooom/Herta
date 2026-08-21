import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BIRTHDAY_CARD_ASSET_MAX_COUNT,
  normalizeBirthdayCardAssetId,
  normalizeBirthdayCardConfig,
} from './birthday-card.ts';

const ASSET_ID = '123e4567-e89b-42d3-a456-426614174000';

test('Birthday Card asset IDはUUIDだけを受理する', () => {
  assert.equal(normalizeBirthdayCardAssetId(ASSET_ID.toUpperCase()), ASSET_ID);
  assert.equal(normalizeBirthdayCardAssetId('../asset.webp'), null);
  assert.equal(normalizeBirthdayCardAssetId(''), null);
  assert.equal(normalizeBirthdayCardAssetId(null), null);
});

test('asset背景は有効なasset IDがある場合だけ有効化する', () => {
  const config = normalizeBirthdayCardConfig({
    birthdayCardBackgroundSource: 'asset',
    birthdayCardAssetId: ASSET_ID,
  });
  assert.equal(config.birthdayCardBackgroundSource, 'asset');
  assert.equal(config.birthdayCardAssetId, ASSET_ID);

  const invalid = normalizeBirthdayCardConfig({
    birthdayCardBackgroundSource: 'asset',
    birthdayCardAssetId: 'not-a-uuid',
  });
  assert.equal(invalid.birthdayCardBackgroundSource, 'preset');
  assert.equal(invalid.birthdayCardAssetId, null);
});

test('既存custom背景設定は後方互換で維持する', () => {
  const config = normalizeBirthdayCardConfig({ birthdayCardBackgroundSource: 'custom' });
  assert.equal(config.birthdayCardBackgroundSource, 'custom');
  assert.equal(config.birthdayCardAssetId, null);
});

test('Asset LibraryはGuildごとに有限件数へ制限する', () => {
  assert.equal(BIRTHDAY_CARD_ASSET_MAX_COUNT, 24);
});
