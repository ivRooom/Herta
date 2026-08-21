import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/route.ts',
  'utf8',
);
const repository = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');

test('Asset upload enforces the Guild library limit inside a serialized DB transaction', () => {
  assert.match(repository, /prisma\.\$transaction/u);
  assert.match(repository, /pg_advisory_xact_lock/u);
  assert.match(repository, /COUNT\(\*\)::INTEGER/u);
  assert.match(repository, /BirthdayCardAssetLimitExceededError/u);
  assert.match(route, /maxAssets: BIRTHDAY_CARD_ASSET_MAX_COUNT/u);
  assert.match(route, /error instanceof BirthdayCardAssetLimitExceededError/u);
  assert.match(route, /status: 409/u);
});
