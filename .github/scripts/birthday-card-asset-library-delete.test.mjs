import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const itemRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);
const guildPlugins = readFileSync('apps/studio/src/lib/guild-plugins.ts', 'utf8');
const assetsDb = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');

test('Persisted active Birthday Card asset cannot be deleted', () => {
  assert.match(itemRoute, /normalizeBirthdayCardConfig\(plugin\?\.config\)/u);
  assert.match(itemRoute, /config\.birthdayCardBackgroundSource === 'asset'/u);
  assert.match(itemRoute, /config\.birthdayCardAssetId === assetId/u);
  assert.match(itemRoute, /status: 409/u);
});

test('Asset selection and deletion share a Guild lock and selection verifies existence', () => {
  assert.match(assetsDb, /birthdayCardAssetGuildLockKey/u);
  assert.match(guildPlugins, /birthdayCardAssetGuildLockKey\(guildId\)/u);
  assert.match(itemRoute, /birthdayCardAssetGuildLockKey\(guildId\)/u);
  assert.match(guildPlugins, /tx\.birthdayCardAsset\.findFirst/u);
  assert.match(itemRoute, /prisma\.\$transaction/u);
  assert.match(itemRoute, /tx\.birthdayCardAsset\.deleteMany/u);
});
