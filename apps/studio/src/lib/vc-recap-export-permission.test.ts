import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasExplicitVcRecapExportPermission,
  studioVcRecapExportResource,
} from './studio-policy-resources.ts';
import {
  STUDIO_ACCESS_POLICY_VERSION,
  type StudioAccessPolicy,
} from './studio-access-policy.ts';

const guildId = '123456789012345678';
const activeRole = '111111111111111111';

function policy(
  effect: 'Allow' | 'Deny',
  action: string,
  resource: string,
): StudioAccessPolicy {
  return {
    Version: STUDIO_ACCESS_POLICY_VERSION,
    Statement: [{ Effect: effect, Action: [action], Resource: [resource] }],
  };
}

function access(policies: StudioAccessPolicy[] = []) {
  return {
    isRoot: false,
    roleIds: [activeRole],
    managedPolicies: policies,
    policies: [] as Array<{ discordRoleId: string; policy: StudioAccessPolicy }>,
  };
}

test('未設定と広い既存operation.execute許可では本文を出力できない', () => {
  assert.equal(hasExplicitVcRecapExportPermission(access(), guildId), false);
  assert.equal(
    hasExplicitVcRecapExportPermission(
      access([policy('Allow', 'studio.operation.execute', `guild:${guildId}:*`)]),
      guildId,
    ),
    false,
  );
  assert.equal(
    hasExplicitVcRecapExportPermission(
      access([policy('Allow', 'studio.*', studioVcRecapExportResource(guildId))]),
      guildId,
    ),
    false,
  );
});

test('現在Guildへの明示的な出力許可でのみダウンロードできる', () => {
  const exact = policy(
    'Allow',
    'studio.operation.execute',
    studioVcRecapExportResource(guildId),
  );
  assert.equal(hasExplicitVcRecapExportPermission(access([exact]), guildId), true);
  assert.equal(
    hasExplicitVcRecapExportPermission(access([exact]), '999999999999999999'),
    false,
  );
});

test('明示的な許可があってもワイルドカードDenyが優先される', () => {
  const exact = policy('Allow', 'studio.operation.execute', studioVcRecapExportResource(guildId));
  const deny = policy('Deny', 'studio.*', `guild:${guildId}:*`);
  assert.equal(hasExplicitVcRecapExportPermission(access([exact, deny]), guildId), false);
});

test('無効なRoleへの明示許可は使えず、Rootは利用可能', () => {
  const exact = policy('Allow', 'studio.operation.execute', studioVcRecapExportResource(guildId));
  const ctx = access();
  ctx.policies.push({ discordRoleId: '222222222222222222', policy: exact });
  assert.equal(hasExplicitVcRecapExportPermission(ctx, guildId), false);
  ctx.policies.push({ discordRoleId: activeRole, policy: exact });
  assert.equal(hasExplicitVcRecapExportPermission(ctx, guildId), true);
  assert.equal(hasExplicitVcRecapExportPermission({ ...access(), isRoot: true }, guildId), true);
});
