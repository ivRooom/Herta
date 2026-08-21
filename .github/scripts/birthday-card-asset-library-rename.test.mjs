import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const itemRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);

test('Asset rename remains bounded and strips control characters', () => {
  assert.match(itemRoute, /MAX_PATCH_BODY_BYTES = 8 \* 1024/u);
  assert.match(itemRoute, /slice\(0, 120\)/u);
  assert.match(itemRoute, /replace\(\/\[\\u0000-\\u001f\\u007f\]\//u);
});
