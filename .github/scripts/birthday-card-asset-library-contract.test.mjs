import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dbBackground = readFileSync('packages/db/src/birthday-card-background.ts', 'utf8');
const botRole = readFileSync('apps/bot/src/plugins/birthday-role.ts', 'utf8');
const catalog = readFileSync('packages/plugin-catalog/src/index.ts', 'utf8');
const editor = readFileSync('apps/studio/src/components/birthday-card-editor.tsx', 'utf8');

test('Asset Library selection is wired through a Bot-only background resolver', () => {
  assert.match(dbBackground, /getBirthdayCardRuntimeBackground/u);
  assert.match(dbBackground, /getBirthdayCardAsset\(prisma, guildId, assetSelection\)/u);
  assert.match(botRole, /getBirthdayCardRuntimeBackground/u);
  assert.match(botRole, /birthdayCardBackgroundSource === 'asset'/u);
  assert.match(catalog, /return config;/u);
  assert.match(editor, /birthdayCardBackgroundSource: 'asset'/u);
  assert.match(editor, /birthdayCardAssetId: asset\.id/u);
});

test('Legacy card-background accessor does not expose Asset Library bytes', () => {
  const legacyAccessor = dbBackground.match(
    /export async function getBirthdayCardBackground\([\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(legacyAccessor);
  assert.match(legacyAccessor, /getLegacyBirthdayCardBackground/u);
  assert.doesNotMatch(legacyAccessor, /getBirthdayCardAsset/u);
});
