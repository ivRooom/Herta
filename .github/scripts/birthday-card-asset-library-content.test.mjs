import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contentRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/content/route.ts',
  'utf8',
);

test('Birthday Card asset binary stays authenticated, private and Guild-scoped', () => {
  assert.match(contentRoute, /const session = await auth\(\)/u);
  assert.match(contentRoute, /studioBirthdayResource\(guildId, 'card-assets'\)/u);
  assert.match(contentRoute, /getBirthdayCardAsset\(prisma, guildId, assetId\)/u);
  assert.match(contentRoute, /private, no-cache, must-revalidate/u);
  assert.match(contentRoute, /ETag/u);
});
