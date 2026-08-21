import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/route.ts',
  'utf8',
);

test('Asset upload refuses new items after the configured Guild library limit', () => {
  assert.match(route, /assetCount >= BIRTHDAY_CARD_ASSET_MAX_COUNT/u);
  assert.match(route, /status: 409/u);
});
