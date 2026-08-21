import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/route.ts',
  'utf8',
);
const repository = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');
const shared = readFileSync('packages/shared/src/birthday-card.ts', 'utf8');

test('Asset Library keeps finite count and bounded upload limits', () => {
  assert.match(shared, /BIRTHDAY_CARD_ASSET_MAX_COUNT = 24/u);
  assert.match(repository, /input\.maxAssets/u);
  assert.match(repository, /pg_advisory_xact_lock/u);
  assert.match(route, /BIRTHDAY_CARD_BACKGROUND_MAX_BYTES \+ MAX_MULTIPART_OVERHEAD_BYTES/u);
  assert.match(route, /UPLOAD_RATE_LIMIT = 10/u);
  assert.match(route, /UPLOAD_RATE_WINDOW_MS = 10 \* 60 \* 1000/u);
});
