import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repository = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');
const policy = readFileSync('apps/studio/src/lib/studio-policy-resources.ts', 'utf8');

test('Dynamic Birthday Card presets stay Guild-scoped in this phase', () => {
  assert.match(repository, /WHERE "guild_id" = \$\{input\.guildId\}/u);
  assert.match(repository, /SET "is_preset" = \$\{input\.isPreset\}/u);
  assert.match(policy, /guild:\$\{guildId\}:birthday:/u);
  assert.doesNotMatch(repository, /global_preset/iu);
});
