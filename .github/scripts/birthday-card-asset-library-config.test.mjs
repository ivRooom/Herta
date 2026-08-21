import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shared = readFileSync('packages/shared/src/birthday-card.ts', 'utf8');
const manifest = readFileSync('packages/plugin-catalog/src/manifests/birthday-role.ts', 'utf8');
const policyResources = readFileSync('apps/studio/src/lib/studio-policy-resources.ts', 'utf8');
const pluginRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/plugins/[pluginId]/route.ts',
  'utf8',
);

test('Birthday Card Asset Library config remains explicit and Guild scoped', () => {
  assert.match(shared, /BirthdayCardBackgroundSource = 'preset' \| 'custom' \| 'asset'/u);
  assert.match(shared, /birthdayCardAssetId: string \| null/u);
  assert.match(manifest, /enum: \['preset', 'asset', 'custom'\]/u);
  const assetIdField = manifest.match(
    /birthdayCardAssetId: \{(?<body>[\s\S]*?)\n      \},\n      birthdayCardPreset:/u,
  );
  assert.ok(assetIdField?.groups?.body, 'birthdayCardAssetId field must exist');
  assert.doesNotMatch(assetIdField.groups.body, /default:/u);
  assert.match(policyResources, /'card-assets'/u);
  assert.match(policyResources, /'card-presets'/u);
  assert.match(pluginRoute, /studioBirthdayResource\(guildId, 'card-assets'\)/u);
  assert.match(pluginRoute, /selectsBirthdayAsset/u);
});
