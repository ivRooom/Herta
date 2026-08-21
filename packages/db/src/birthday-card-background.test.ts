import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBirthdayCardAssetSelection } from './birthday-card-background.js';

const ASSET_ID = '123e4567-e89b-42d3-a456-426614174000';

test('Asset Library選択時は正規化済みAsset IDを返す', () => {
  assert.equal(
    resolveBirthdayCardAssetSelection({
      birthdayCardBackgroundSource: 'asset',
      birthdayCardAssetId: ASSET_ID.toUpperCase(),
    }),
    ASSET_ID,
  );
});

test('Asset Library選択でIDが不正なら旧背景へfall backせずnullにする', () => {
  assert.equal(
    resolveBirthdayCardAssetSelection({
      birthdayCardBackgroundSource: 'asset',
      birthdayCardAssetId: '../../preset.webp',
    }),
    null,
  );
  assert.equal(
    resolveBirthdayCardAssetSelection({ birthdayCardBackgroundSource: 'asset' }),
    null,
  );
});

test('preset/customではlegacy background lookupを維持する', () => {
  assert.equal(
    resolveBirthdayCardAssetSelection({ birthdayCardBackgroundSource: 'preset' }),
    undefined,
  );
  assert.equal(
    resolveBirthdayCardAssetSelection({ birthdayCardBackgroundSource: 'custom' }),
    undefined,
  );
  assert.equal(resolveBirthdayCardAssetSelection(null), undefined);
});
