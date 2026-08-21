import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync('apps/studio/src/components/birthday-card-editor.tsx', 'utf8');
const library = readFileSync('apps/studio/src/components/birthday-card-asset-library.tsx', 'utf8');

test('Dynamic Guild presets are managed from the Dashboard asset library', () => {
  assert.match(editor, /BirthdayCardAssetLibrary/u);
  assert.match(library, /Guild Preset/u);
  assert.match(library, /Presetに追加/u);
});
