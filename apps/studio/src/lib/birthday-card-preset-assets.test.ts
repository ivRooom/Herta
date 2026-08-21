import assert from 'node:assert/strict';
import test from 'node:test';
import { BIRTHDAY_CARD_PRESETS } from '@herta/shared';
import {
  birthdayCardPresetAssetPathCandidates,
  isBirthdayCardPresetAssetFile,
  readBirthdayCardPresetAsset,
} from './birthday-card-preset-assets.ts';

test('Birthday Card presetはmanifestのallowlistだけを配信する', () => {
  for (const preset of BIRTHDAY_CARD_PRESETS) {
    assert.equal(isBirthdayCardPresetAssetFile(preset.assetFile), true);
  }
  assert.equal(isBirthdayCardPresetAssetFile('../package.json'), false);
  assert.deepEqual(birthdayCardPresetAssetPathCandidates(process.cwd(), '../package.json'), []);
});

test('Studio runtime候補から全Birthday Card presetをWebPとして読み込める', async () => {
  for (const preset of BIRTHDAY_CARD_PRESETS) {
    const asset = await readBirthdayCardPresetAsset(preset.assetFile);
    assert.ok(asset, `${preset.assetFile} should be readable`);
    assert.equal(asset.contentType, 'image/webp');
    assert.ok(asset.bytes.byteLength > 0);
  }
});
