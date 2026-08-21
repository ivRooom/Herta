import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const assets = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');
const itemRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);

test('Preset mutation and deletion share the Guild advisory lock', () => {
  const presetMutation = assets.slice(
    assets.indexOf('export async function setBirthdayCardAssetPreset'),
    assets.indexOf('export async function deleteBirthdayCardAsset'),
  );
  assert.match(presetMutation, /prisma\.\$transaction/u);
  assert.match(presetMutation, /birthdayCardAssetGuildLockKey\(input\.guildId\)/u);
  assert.match(presetMutation, /pg_advisory_xact_lock/u);
  assert.match(presetMutation, /UPDATE "birthday_card_assets"/u);
  assert.match(itemRoute, /birthdayCardAssetGuildLockKey\(guildId\)/u);
  assert.match(itemRoute, /pg_advisory_xact_lock/u);
});
