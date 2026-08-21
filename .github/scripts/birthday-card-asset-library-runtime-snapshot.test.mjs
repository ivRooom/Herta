import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const background = readFileSync('packages/db/src/birthday-card-background.ts', 'utf8');
const botRole = readFileSync('apps/bot/src/plugins/birthday-role.ts', 'utf8');

test('Birthday Card runtime background uses the worker config snapshot', () => {
  assert.match(background, /configSnapshot: unknown/u);
  assert.match(background, /resolveBirthdayCardAssetSelection\(configSnapshot\)/u);
  assert.doesNotMatch(background, /guildPlugin\.findUnique/u);
  assert.match(
    botRole,
    /getBirthdayCardRuntimeBackground\(context\.prisma, context\.guildId, config\)/u,
  );
});
