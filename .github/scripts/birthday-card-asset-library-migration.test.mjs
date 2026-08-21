import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'packages/db/prisma/migrations/20260821013000_birthday_card_asset_library/migration.sql',
  'utf8',
);

test('Birthday Card Asset Library migration keeps Guild scope and image constraints', () => {
  assert.match(migration, /CREATE TABLE "birthday_card_assets"/u);
  assert.match(migration, /PRIMARY KEY \("id"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("guild_id"\) REFERENCES "guilds"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/u,
  );
  assert.match(migration, /"content_type" IN \('image\/png', 'image\/jpeg', 'image\/webp'\)/u);
  assert.match(migration, /"size_bytes" > 0 AND "size_bytes" <= 5242880/u);
  assert.match(migration, /"width" <= 8192 AND "height" <= 8192/u);
  assert.match(migration, /"width"::BIGINT \* "height"::BIGINT <= 16000000/u);
  assert.match(migration, /"sha256" ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /"is_preset" BOOLEAN NOT NULL DEFAULT FALSE/u);
});
