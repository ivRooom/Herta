import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
});
