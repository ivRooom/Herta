import {
  evaluateStudioPolicyDocuments,
  type StudioAccessPolicy,
  type StudioPolicyAction,
} from './studio-access-policy.ts';

export type ExplicitPermissionMode = 'inherit' | 'allow' | 'deny';

export interface EffectivePluginPermissionContext {
  isRoot: boolean;
  roleIds: readonly string[];
  policies: readonly { discordRoleId: string; policy: StudioAccessPolicy }[];
  managedPolicies: readonly StudioAccessPolicy[];
}

export interface PluginConfigStudioAccess {
  canToggleEnabled: boolean;
  readableFieldKeys: string[];
  editableFieldKeys: string[];
}

export function pluginConfigFieldResource(
  guildId: string,
  pluginId: string,
  fieldKey: string,
): string {
  return `guild:${guildId}:plugin:${encodeSegment(pluginId)}:config:${encodeSegment(fieldKey)}`;
}

export function pluginEnabledControlResource(guildId: string, pluginId: string): string {
  return `guild:${guildId}:plugin:${encodeSegment(pluginId)}:control:enabled`;
}

export function hasEffectivePluginPermission(
  access: EffectivePluginPermissionContext,
  action: StudioPolicyAction,
  resource: string,
): boolean {
  if (access.isRoot) return true;
  const policies = effectivePolicies(access);

  // Policy未導入のManage Guildユーザーは従来挙動を維持し、段階移行を可能にする。
  if (policies.length === 0) return true;
  return evaluateStudioPolicyDocuments(policies, action, resource);
}

export function resolvePluginConfigStudioAccess(
  access: EffectivePluginPermissionContext,
  guildId: string,
  pluginId: string,
  fieldKeys: readonly string[],
): PluginConfigStudioAccess {
  const uniqueFieldKeys = [...new Set(fieldKeys)];
  const enforceReadPolicy = hasConfiguredSettingsReadPolicy(access);
  return {
    canToggleEnabled: hasEffectivePluginPermission(
      access,
      'studio.operation.execute',
      pluginEnabledControlResource(guildId, pluginId),
    ),
    readableFieldKeys: enforceReadPolicy
      ? uniqueFieldKeys.filter((fieldKey) =>
          hasEffectivePluginPermission(
            access,
            'studio.settings.read',
            pluginConfigFieldResource(guildId, pluginId, fieldKey),
          ),
        )
      : uniqueFieldKeys,
    editableFieldKeys: uniqueFieldKeys.filter((fieldKey) =>
      hasEffectivePluginPermission(
        access,
        'studio.settings.write',
        pluginConfigFieldResource(guildId, pluginId, fieldKey),
      ),
    ),
  };
}

export function filterReadablePluginConfig(
  config: Record<string, unknown>,
  access: Pick<PluginConfigStudioAccess, 'readableFieldKeys'>,
): Record<string, unknown> {
  const readable = new Set(access.readableFieldKeys);
  return Object.fromEntries(Object.entries(config).filter(([key]) => readable.has(key)));
}

export function getExplicitPermissionMode(
  policy: StudioAccessPolicy,
  action: StudioPolicyAction,
  resource: string,
): ExplicitPermissionMode {
  const statement = policy.Statement.find(
    (candidate) =>
      candidate.Sid === generatedSid(action, resource) &&
      candidate.Action.length === 1 &&
      candidate.Action[0] === action &&
      candidate.Resource.length === 1 &&
      candidate.Resource[0] === resource,
  );
  if (!statement) return 'inherit';
  return statement.Effect === 'Deny' ? 'deny' : 'allow';
}

export function setExplicitPermissionMode(
  policy: StudioAccessPolicy,
  action: StudioPolicyAction,
  resource: string,
  mode: ExplicitPermissionMode,
): StudioAccessPolicy {
  const sid = generatedSid(action, resource);
  const statements = policy.Statement.filter((statement) => statement.Sid !== sid);
  if (mode === 'inherit') return { ...policy, Statement: statements };

  return {
    ...policy,
    Statement: [
      ...statements,
      {
        Sid: sid,
        Effect: mode === 'deny' ? 'Deny' : 'Allow',
        Action: [action],
        Resource: [resource],
      },
    ],
  };
}

function hasConfiguredSettingsReadPolicy(access: EffectivePluginPermissionContext): boolean {
  return effectivePolicies(access).some((policy) =>
    policy.Statement.some((statement) => statement.Action.some(isSettingsReadActionPattern)),
  );
}

function effectivePolicies(access: EffectivePluginPermissionContext): StudioAccessPolicy[] {
  const activeRoleIds = new Set(access.roleIds);
  return [
    ...access.managedPolicies,
    ...access.policies
      .filter((policy) => activeRoleIds.has(policy.discordRoleId))
      .map((policy) => policy.policy),
  ];
}

function isSettingsReadActionPattern(action: string): boolean {
  return (
    action === '*' ||
    action === 'studio.*' ||
    action === 'studio.settings.*' ||
    action === 'studio.settings.read'
  );
}

function generatedSid(action: StudioPolicyAction, resource: string): string {
  return `PluginPermission${stableHash(`${action}:${resource}`)}`;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
