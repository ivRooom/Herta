import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dbBackground = readFileSync('packages/db/src/birthday-card-background.ts', 'utf8');
const catalog = readFileSync('packages/plugin-catalog/src/index.ts', 'utf8');
const editor = readFileSync('apps/studio/src/components/birthday-card-editor.tsx', 'utf8');

test('Asset Library selection is wired from persisted config to Bot background bytes', () => {
  assert.match(dbBackground, /birthdayCardBackgroundSource/u);
  assert.match(dbBackground, /getBirthdayCardAsset\(prisma, guildId, assetSelection\)/u);
  assert.match(catalog, /birthdayCardBackgroundSource: 'custom'/u);
  assert.match(editor, /birthdayCardBackgroundSource: 'asset'/u);
  assert.match(editor, /birthdayCardAssetId: asset\.id/u);
});
