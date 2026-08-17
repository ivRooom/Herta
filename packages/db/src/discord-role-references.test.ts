import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectHertaDiscordRoleReferences,
  containsExactJsonStringValue,
  type HertaDiscordRoleReferenceSnapshot,
} from './discord-role-references.js';

const ROLE_ID = '123456789012345678';

function snapshot(
  overrides: Partial<HertaDiscordRoleReferenceSnapshot> = {},
): HertaDiscordRoleReferenceSnapshot {
  return {
    settings: {
      modRoleIds: [],
      adminRoleIds: [],
      settingsJson: {},
    },
    plugins: [],
    ...overrides,
  };
}

test('GuildSettingsとPlugin config内のRole参照を検出する', () => {
  const references = collectHertaDiscordRoleReferences(
    snapshot({
      settings: {
        modRoleIds: [ROLE_ID],
        adminRoleIds: [ROLE_ID],
        settingsJson: { birthday: { roleId: ROLE_ID } },
      },
      plugins: [{ pluginId: 'moderation', config: { nested: [{ roleId: ROLE_ID }] } }],
    }),
    ROLE_ID,
  );

  assert.deepEqual(references, [
    'GuildSettings.modRoleIds',
    'GuildSettings.adminRoleIds',
    'GuildSettings.settingsJson',
    'Plugin:moderation',
  ]);
});

test('自動cleanup対象のStudio Role Policyだけなら削除を妨げない', () => {
  const references = collectHertaDiscordRoleReferences(
    snapshot({
      settings: {
        modRoleIds: [],
        adminRoleIds: [],
        settingsJson: {
          studioAccess: {
            rolePolicies: {
              [ROLE_ID]: {
                Version: '2026-08-17',
                Statement: [],
              },
            },
          },
        },
      },
    }),
    ROLE_ID,
  );

  assert.deepEqual(references, []);
});

test('studioAccess内でもRole Policy以外の参照は保護する', () => {
  const references = collectHertaDiscordRoleReferences(
    snapshot({
      settings: {
        modRoleIds: [],
        adminRoleIds: [],
        settingsJson: {
          studioAccess: {
            rolePolicies: {},
            futureRoleReference: ROLE_ID,
          },
        },
      },
    }),
    ROLE_ID,
  );

  assert.deepEqual(references, ['GuildSettings.settingsJson']);
});

test('部分一致する文字列はRole参照として扱わない', () => {
  assert.equal(containsExactJsonStringValue({ roleId: `${ROLE_ID}0` }, ROLE_ID), false);
  assert.equal(containsExactJsonStringValue({ message: `role:${ROLE_ID}` }, ROLE_ID), false);
  assert.equal(containsExactJsonStringValue({ roleId: ROLE_ID }, ROLE_ID), true);
});

test('極端に深いJSONは探索深度を制限する', () => {
  let value: unknown = ROLE_ID;
  for (let index = 0; index < 20; index += 1) {
    value = { nested: value };
  }

  assert.equal(containsExactJsonStringValue(value, ROLE_ID), false);
});
