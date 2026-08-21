import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dbBackground = readFileSync('packages/db/src/birthday-card-background.ts', 'utf8');
const renderer = readFileSync('apps/bot/src/plugins/birthday-card.ts', 'utf8');

test('Missing selected library asset falls back to bundled Birthday preset safely', () => {
  assert.match(dbBackground, /if \(!asset\) return null/u);
  assert.match(renderer, /Continue to the bundled preset/u);
  assert.match(renderer, /readPresetBackground/u);
});
