import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const collection = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/route.ts',
  'utf8',
);
const item = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);
const content = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/content/route.ts',
  'utf8',
);
const library = readFileSync('apps/studio/src/components/birthday-card-asset-library.tsx', 'utf8');

test('Birthday Card Asset Library mutations and reads keep server-side boundaries', () => {
  assert.match(collection, /isSameOriginMutationRequest\(request\)/u);
  assert.match(collection, /readRequestBodyBytes/u);
  assert.match(collection, /inspectBirthdayCardBackgroundImage/u);
  assert.match(collection, /studioBirthdayResource\(guildId, 'card-assets'\)/u);
  assert.match(item, /isSameOriginMutationRequest\(request\)/u);
  assert.match(item, /studioBirthdayResource\(guildId, 'card-presets'\)/u);
  assert.match(item, /現在使用中の画像は削除できません/u);
  assert.match(content, /getBirthdayCardAsset\(prisma, guildId, assetId\)/u);
  assert.match(content, /'X-Content-Type-Options': 'nosniff'/u);
  assert.match(content, /'Cache-Control': 'private, no-cache, must-revalidate'/u);
});

test('Write-only uploads do not disclose Asset Library metadata', () => {
  assert.match(
    collection,
    /const assetReadAccess = await authorizeBirthdayStudioPermission\([\s\S]*?'studio\.settings\.read'[\s\S]*?studioBirthdayResource\(guildId, 'card-assets'\)/u,
  );
  assert.match(
    collection,
    /if \(!assetReadAccess\.ok\) return NextResponse\.json\(\{ created: true \}, \{ status: 201 \}\);/u,
  );
  assert.match(collection, /return NextResponse\.json\(\{ asset: serializeAsset\(asset\) \}/u);
  assert.match(library, /\{canRead && canWrite \? \(/u);
});
