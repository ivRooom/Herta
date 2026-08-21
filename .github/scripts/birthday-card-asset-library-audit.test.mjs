import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const collection = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/route.ts',
  'utf8',
);
const item = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);

test('Asset Library writes metadata-only audit events for lifecycle changes', () => {
  assert.match(collection, /birthday_card\.asset\.created/u);
  assert.match(item, /birthday_card\.asset\.renamed/u);
  assert.match(item, /birthday_card\.asset\.preset_added/u);
  assert.match(item, /birthday_card\.asset\.preset_removed/u);
  assert.match(item, /birthday_card\.asset\.deleted/u);
  assert.doesNotMatch(collection, /metadata:\s*\{[^}]*content:/su);
  assert.doesNotMatch(item, /metadata:\s*\{[^}]*content:/su);
});
