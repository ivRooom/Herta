import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStudioGranularPermissionOptions,
  hasApplicableStudioPolicy,
  studioAccessPageResource,
  studioPageResource,
  topLevelConfigFields,
} from './studio-policy-resources.ts';

const GUILD_ID = '123456789012345678';

test('Studio page resourceをGuild scopeで生成する', () => {
  assert.equal(studioPageResource(GUILD_ID, 'moderation'), `guild:${GUILD_ID}:page:moderation`);
  assert.equal(studioPageResource(GUILD_ID, 'audit-logs'), `guild:${GUILD_ID}:page:audit-logs`);
});

test('Access Control subpage resourceを個別に生成する', () => {
  assert.equal(
    studioAccessPageResource(GUILD_ID, 'policies'),
    `guild:${GUILD_ID}:access:policies`,
  );
  assert.notEqual(
    studioAccessPageResource(GUILD_ID, 'users'),
    studioAccessPageResource(GUILD_ID, 'groups'),
  );
});

test('適用対象Policyがない場合はpage policyを段階導入できる', () => {
  assert.equal(
    hasApplicableStudioPolicy({
      roleIds: ['role-a'],
      policies: [{ discordRoleId: 'role-b' }],
      managedPolicies: [],
    }),
    false,
  );
  assert.equal(
    hasApplicableStudioPolicy({
      roleIds: ['role-a'],
      policies: [{ discordRoleId: 'role-a' }],
      managedPolicies: [],
    }),
    true,
  );
  assert.equal(
    hasApplicableStudioPolicy({ roleIds: [], policies: [], managedPolicies: [{}] }),
    true,
  );
});

test('Plugin schemaから設定項目の表示情報を解決する', () => {
  assert.deepEqual(
    topLevelConfigFields({
      type: 'object',
      properties: {
        autoMentionLimit: { type: 'integer', title: 'メンション上限', description: '上限値' },
        log_channel: { type: 'string' },
      },
    }),
    [
      { key: 'autoMentionLimit', label: 'メンション上限', description: '上限値' },
      { key: 'log_channel', label: 'Log channel', description: '' },
    ],
  );
});

test('Policy catalogはpageとPlugin fieldのread/writeを別Resource権限として生成する', () => {
  const options = buildStudioGranularPermissionOptions(GUILD_ID, [
    {
      id: 'moderation',
      name: 'Moderation',
      configSchema: {
        type: 'object',
        properties: {
          autoMentionLimit: { type: 'integer', title: 'メンション上限' },
        },
      },
    },
  ]);

  assert.ok(
    options.some(
      (option) =>
        option.action === 'studio.page.view' &&
        option.resource === `guild:${GUILD_ID}:page:moderation`,
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.action === 'studio.settings.read' &&
        option.resource === `guild:${GUILD_ID}:plugin:moderation:config:autoMentionLimit`,
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.action === 'studio.settings.write' &&
        option.resource === `guild:${GUILD_ID}:plugin:moderation:config:autoMentionLimit`,
    ),
  );
});
