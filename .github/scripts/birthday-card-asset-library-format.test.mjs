import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'packages/db/prisma/migrations/20260821013000_birthday_card_asset_library/migration.sql',
  'utf8',
);
const route = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/route.ts',
  'utf8',
);

test('Asset Library accepts only PNG JPEG and WebP at DB and application boundaries', () => {
  assert.match(migration, /image\/png/u);
  assert.match(migration, /image\/jpeg/u);
  assert.match(migration, /image\/webp/u);
  assert.match(route, /inspectBirthdayCardBackgroundImage/u);
});
