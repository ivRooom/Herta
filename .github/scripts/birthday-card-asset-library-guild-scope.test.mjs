import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repository = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');

test('Birthday Card Asset Library reads and mutations always include Guild scope', () => {
  assert.match(repository, /WHERE "guild_id" = \$\{guildId\}/u);
  assert.match(repository, /WHERE "guild_id" = \$\{input\.guildId\}/u);
});
