import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const itemRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);

test('Guild Preset promotion uses a separate IAM resource from asset editing', () => {
  assert.match(itemRoute, /studioBirthdayResource\(guildId, 'card-assets'\)/u);
  assert.match(itemRoute, /studioBirthdayResource\(guildId, 'card-presets'\)/u);
});
