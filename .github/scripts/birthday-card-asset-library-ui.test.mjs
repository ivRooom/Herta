import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(
  'apps/studio/src/app/dashboard/guilds/[guildId]/birthday/page.tsx',
  'utf8',
);
const editor = readFileSync('apps/studio/src/components/birthday-card-editor.tsx', 'utf8');
const library = readFileSync('apps/studio/src/components/birthday-card-asset-library.tsx', 'utf8');

test('Upload and Guild Preset promotion remain separate Birthday Card actions', () => {
  assert.match(editor, /method: 'POST'/u);
  assert.match(editor, /\/birthday\/card-assets/u);
  assert.match(editor, /\{ isPreset: !asset\.isPreset \}/u);
  assert.match(library, /画像を登録/u);
  assert.match(library, /Presetに追加/u);
  assert.match(library, /Presetから解除/u);
  assert.match(library, /この背景を使用/u);
  assert.match(editor, /canUseAsset =\s*canWriteAssets &&/su);
  assert.match(
    editor,
    /selectedDraftAsset =\s*config\.birthdayCardBackgroundSource === 'asset' &&/su,
  );
  assert.match(
    editor,
    /saved\.birthdayCardBackgroundSource === 'asset' && asset\.id === saved\.birthdayCardAssetId/su,
  );
  assert.match(library, /protectedFromDelete/u);
});

test('Asset Library media permissions render independently from config-field read access', () => {
  assert.match(page, /const hasReadableCardConfig = configAccess\.readableFieldKeys\.length > 0;/u);
  assert.match(
    page,
    /const canAccessCardMedia =\s*canReadCardBackground \|\|\s*canWriteCardBackground \|\|\s*canReadAssets \|\|\s*canWriteAssets \|\|\s*canManagePresets;/su,
  );
  assert.match(page, /hasReadableCardConfig \|\| canAccessCardMedia \? \(/u);
  assert.match(page, /canReadAssets=\{canReadAssets\}/u);
  assert.match(page, /canWriteAssets=\{canWriteAssets\}/u);
  assert.match(page, /canManagePresets=\{canManagePresets\}/u);
});
