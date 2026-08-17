import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STUDIO_ROOT_DISCORD_ROLE_ID,
  createStudioRolePolicyFromActions,
  evaluateStudioAccessPolicy,
  isStudioRootRole,
  validateStudioAccessPolicy,
} from './studio-access-policy.ts';

const GUILD_ID = '123456789012345678';
const ROLE_ID = '234567890123456789';

test('GUI Policyは選択ActionをGuild scopeへAllowする', () => {
  const policy = createStudioRolePolicyFromActions(GUILD_ID, ['studio.page.view', 'studio.ai.use']);
  assert.deepEqual(policy.Statement[0]?.Action, ['studio.page.view', 'studio.ai.use']);
  assert.deepEqual(policy.Statement[0]?.Resource, [`guild:${GUILD_ID}:*`]);
});

test('AllowされたRoleだけが一致ActionとResourceへアクセスできる', () => {
  const policy = createStudioRolePolicyFromActions(GUILD_ID, ['studio.ai.use']);
  assert.equal(
    evaluateStudioAccessPolicy({
      roleIds: [ROLE_ID],
      policies: [{ discordRoleId: ROLE_ID, policy }],
      action: 'studio.ai.use',
      resource: `guild:${GUILD_ID}:ai:chat`,
    }),
    true,
  );
  assert.equal(
    evaluateStudioAccessPolicy({
      roleIds: [ROLE_ID],
      policies: [{ discordRoleId: ROLE_ID, policy }],
      action: 'studio.secrets.manage',
      resource: `guild:${GUILD_ID}:secret:gemini`,
    }),
    false,
  );
});

test('DenyはAllowより優先される', () => {
  const policy = {
    Version: '2026-08-17' as const,
    Statement: [
      { Effect: 'Allow' as const, Action: ['studio.ai.*'], Resource: [`guild:${GUILD_ID}:*`] },
      {
        Effect: 'Deny' as const,
        Action: ['studio.ai.manage'],
        Resource: [`guild:${GUILD_ID}:ai:settings`],
      },
    ],
  };
  assert.equal(
    evaluateStudioAccessPolicy({
      roleIds: [ROLE_ID],
      policies: [{ discordRoleId: ROLE_ID, policy }],
      action: 'studio.ai.manage',
      resource: `guild:${GUILD_ID}:ai:settings`,
    }),
    false,
  );
});

test('Guild外Resourceと未知Actionを拒否する', () => {
  const result = validateStudioAccessPolicy(
    {
      Version: '2026-08-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['studio.unknown.execute'],
          Resource: ['guild:999999999999999999:*'],
        },
      ],
    },
    GUILD_ID,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2);
});

test('OWNER Role IDだけをrootとして識別する', () => {
  assert.equal(isStudioRootRole([STUDIO_ROOT_DISCORD_ROLE_ID]), true);
  assert.equal(isStudioRootRole([ROLE_ID]), false);
});
