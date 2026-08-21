import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repository = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');
const item = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);

test('Asset Library writes metadata-only audit events for lifecycle changes', () => {
  assert.match(repository, /birthday_card\.asset\.created/u);
  assert.match(item, /birthday_card\.asset\.renamed/u);
  assert.match(item, /birthday_card\.asset\.preset_added/u);
  assert.match(item, /birthday_card\.asset\.preset_removed/u);
  assert.match(item, /birthday_card\.asset\.deleted/u);
  assert.doesNotMatch(repository, /metadata:\s*\{[^}]*content:/su);
  assert.doesNotMatch(item, /metadata:\s*\{[^}]*content:/su);
});

test('Asset metadata PATCH commits mutations and audit events atomically', () => {
  assert.match(item, /const asset = await prisma\.\$transaction\(async \(tx\) => \{/u);
  assert.match(
    item,
    /const asset = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*birthday_card\.asset\.renamed[\s\S]*birthday_card\.asset\.preset_added[\s\S]*return current;[\s\S]*\}\);/u,
  );
  assert.doesNotMatch(item, /await prisma\.auditLog\.create/u);
});
