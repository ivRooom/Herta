import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BIRTHDAY_CARD_ASSET_MAX_COUNT,
  normalizeBirthdayCardAssetId,
  normalizeBirthdayCardConfig,
  parseBirthdayCardPresetDefinition,
} from './birthday-card.js';

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

test('DBプリセット定義は正しい形だけを受理する (#1028 R3-E)', () => {
  const definition = {
    id: 'my-custom-preset',
    label: 'カスタムプリセット',
    backgroundUrl: 'https://media.example.com/birthday/bg.webp',
    textColor: '#ff0000',
    textStroke: '#00FF00',
  };
  assert.deepEqual(parseBirthdayCardPresetDefinition(definition), definition);

  for (const invalid of [
    null,
    'my-custom-preset',
    { ...definition, id: 'Bad Slug' },
    { ...definition, id: 'a' },
    { ...definition, label: '' },
    { ...definition, backgroundUrl: 'http://media.example.com/birthday/bg.webp' },
    { ...definition, backgroundUrl: 'not-a-url' },
    { ...definition, textColor: 'red' },
    { ...definition, textColor: '#fff' },
    { ...definition, textStroke: '#12345678' },
    { ...definition, extra: true },
    { id: definition.id, label: definition.label },
  ]) {
    assert.equal(parseBirthdayCardPresetDefinition(invalid), null);
  }
});
