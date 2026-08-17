import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateStudioPolicyDocuments,
  validateStudioAccessPolicy,
  type StudioAccessPolicy,
} from './studio-access-policy.ts';

const GUILD_ID = '123456789012345678';

function policy(
  effect: 'Allow' | 'Deny',
  action: StudioAccessPolicy['Statement'][number]['Action'][number],
  resource = `guild:${GUILD_ID}:*`,
): StudioAccessPolicy {
  return {
    Version: '2026-08-17',
    Statement: [{ Effect: effect, Action: [action], Resource: [resource] }],
  };
}

test('複数Principal由来PolicyのAllowを合成できる', () => {
  const directUser = policy('Allow', 'studio.ai.use');
  const role = policy('Allow', 'studio.settings.read');
  const group = policy('Allow', 'studio.commands.execute');

  assert.equal(
    evaluateStudioPolicyDocuments(
      [directUser, role, group],
      'studio.commands.execute',
      `guild:${GUILD_ID}:command:ping`,
    ),
    true,
  );
});

test('User/Role/Group/legacyのどこか1つのExplicit DenyがAllowより優先される', () => {
  const managedAllow = policy('Allow', 'studio.settings.write');
  const legacyAllow = policy('Allow', 'studio.settings.write');
  const groupDeny = policy(
    'Deny',
    'studio.settings.write',
    `guild:${GUILD_ID}:plugin:moderation:config:*`,
  );

  assert.equal(
    evaluateStudioPolicyDocuments(
      [managedAllow, legacyAllow, groupDeny],
      'studio.settings.write',
      `guild:${GUILD_ID}:plugin:moderation:config:threshold`,
    ),
    false,
  );
});

test('一致するAllowがない場合はdefault denyになる', () => {
  assert.equal(
    evaluateStudioPolicyDocuments(
      [policy('Allow', 'studio.settings.read')],
      'studio.secrets.manage',
      `guild:${GUILD_ID}:secret:openai`,
    ),
    false,
  );
});

test('Wildcard Allowもより具体的なDenyで拒否される', () => {
  const broadAllow = policy('Allow', 'studio.ai.*');
  const specificDeny = policy('Deny', 'studio.ai.manage', `guild:${GUILD_ID}:ai:settings`);

  assert.equal(
    evaluateStudioPolicyDocuments(
      [broadAllow, specificDeny],
      'studio.ai.manage',
      `guild:${GUILD_ID}:ai:settings`,
    ),
    false,
  );
});

test('Managed Policy documentもGuild外Resourceを拒否する', () => {
  const validation = validateStudioAccessPolicy(
    {
      Version: '2026-08-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['studio.page.view'],
          Resource: ['guild:999999999999999999:*'],
        },
      ],
    },
    GUILD_ID,
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('Guild外')));
});
