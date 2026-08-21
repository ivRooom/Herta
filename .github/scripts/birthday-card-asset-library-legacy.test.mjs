import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync('apps/studio/src/components/birthday-card-editor.tsx', 'utf8');
const dbBackground = readFileSync('packages/db/src/birthday-card-background.ts', 'utf8');

test('Legacy one-image custom background remains available during Asset Library migration', () => {
  assert.match(editor, /旧カスタム背景（互換）/u);
  assert.match(editor, /card-background/u);
  assert.match(dbBackground, /FROM "birthday_card_backgrounds"/u);
  assert.match(dbBackground, /resolveBirthdayCardAssetSelection/u);
});
