import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const itemRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);

test('Persisted active Birthday Card asset cannot be deleted', () => {
  assert.match(itemRoute, /normalizeBirthdayCardConfig\(plugin\?\.config\)/u);
  assert.match(itemRoute, /config\.birthdayCardBackgroundSource === 'asset'/u);
  assert.match(itemRoute, /config\.birthdayCardAssetId === assetId/u);
  assert.match(itemRoute, /status: 409/u);
});
