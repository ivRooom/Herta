import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyStudioAccessPolicy, setStudioGuiActions } from './studio-access-policy.ts';
import {
  buildStudioGranularPermissionOptions,
  hasConfiguredStudioPagePolicy,
  studioAccessPageResource,
  studioBirthdayResource,
  studioPageResource,
  studioParentPageId,
  topLevelConfigFields,
} from './studio-policy-resources.ts';

const GUILD_ID = '123456789012345678';

test('Studio page resourceをGuild scopeで生成する', () => {
  assert.equal(studioPageResource(GUILD_ID, 'moderation'), `guild:${GUILD_ID}:page:moderation`);
  assert.equal(studioPageResource(GUILD_ID, 'audit-logs'), `guild:${GUILD_ID}:page:audit-logs`);
});

test('Moderation subpage resourceを個別化し、旧Moderation pageを親権限として保持する', () => {
  assert.equal(
    studioPageResource(GUILD_ID, 'moderation-detections'),
    `guild:${GUILD_ID}:page:moderation-detections`,
  );
  assert.equal(
    studioPageResource(GUILD_ID, 'moderation-enforcement'),
    `guild:${GUILD_ID}:page:moderation-enforcement`,
  );
  assert.notEqual(
    studioPageResource(GUILD_ID, 'moderation-blacklist'),
    studioPageResource(GUILD_ID, 'moderation-detection-settings'),
  );
  assert.equal(studioParentPageId('moderation-cases'), 'moderation');
  assert.equal(studioParentPageId('moderation-blacklist'), 'moderation');
  assert.equal(studioParentPageId('birthday'), null);
});

test('Access Control subpage resourceを個別に生成する', () => {
  assert.equal(studioAccessPageResource(GUILD_ID, 'policies'), `guild:${GUILD_ID}:access:policies`);
  assert.notEqual(
    studioAccessPageResource(GUILD_ID, 'users'),
    studioAccessPageResource(GUILD_ID, 'groups'),
  );
});

test('Birthday resourceは登録・祝い実績・Card背景・テスト送信を分離する', () => {
  assert.equal(
    studioBirthdayResource(GUILD_ID, 'registrations'),
    `guild:${GUILD_ID}:birthday:registrations`,
  );
  assert.equal(
    studioBirthdayResource(GUILD_ID, 'celebrations'),
    `guild:${GUILD_ID}:birthday:celebrations`,
  );
  assert.equal(
    studioBirthdayResource(GUILD_ID, 'card-background'),
    `guild:${GUILD_ID}:birthday:card-background`,
  );
  assert.equal(
    studioBirthdayResource(GUILD_ID, 'card-test-send'),
    `guild:${GUILD_ID}:birthday:card-test-send`,
  );
  assert.equal(
    new Set([
      studioBirthdayResource(GUILD_ID, 'registrations'),
      studioBirthdayResource(GUILD_ID, 'celebrations'),
      studioBirthdayResource(GUILD_ID, 'card-background'),
      studioBirthdayResource(GUILD_ID, 'card-test-send'),
    ]).size,
    4,
  );
});

test('page.viewが明示されるまでpage policyのdefault denyを有効化しない', () => {
  const empty = createEmptyStudioAccessPolicy();
  assert.equal(
    hasConfiguredStudioPagePolicy({
      roleIds: ['role-a'],
      policies: [{ discordRoleId: 'role-a', policy: empty }],
      managedPolicies: [],
    }),
    false,
  );

  const pagePolicy = setStudioGuiActions(empty, GUILD_ID, ['studio.page.view']);
  assert.equal(
    hasConfiguredStudioPagePolicy({
      roleIds: ['role-a'],
      policies: [{ discordRoleId: 'role-a', policy: pagePolicy }],
      managedPolicies: [],
    }),
    true,
  );
  assert.equal(
    hasConfiguredStudioPagePolicy({
      roleIds: [],
      policies: [],
      managedPolicies: [pagePolicy],
    }),
    true,
  );
});

test('別Roleのpage policyはpage default denyを有効化しない', () => {
  const pagePolicy = setStudioGuiActions(createEmptyStudioAccessPolicy(), GUILD_ID, [
    'studio.page.view',
  ]);
  assert.equal(
    hasConfiguredStudioPagePolicy({
      roleIds: ['role-a'],
      policies: [{ discordRoleId: 'role-b', policy: pagePolicy }],
      managedPolicies: [],
    }),
    false,
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

test('Policy catalogはpage・Birthday・Plugin fieldを別Resource権限として生成する', () => {
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
        option.action === 'studio.page.view' &&
        option.resource === `guild:${GUILD_ID}:page:moderation-detections`,
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.action === 'studio.page.view' &&
        option.resource === `guild:${GUILD_ID}:page:moderation-enforcement`,
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.action === 'studio.settings.write' &&
        option.resource === `guild:${GUILD_ID}:birthday:registrations`,
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.action === 'studio.settings.read' &&
        option.resource === `guild:${GUILD_ID}:birthday:celebrations`,
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.action === 'studio.settings.write' &&
        option.resource === `guild:${GUILD_ID}:birthday:card-background`,
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.action === 'studio.operation.execute' &&
        option.resource === `guild:${GUILD_ID}:birthday:card-test-send`,
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
