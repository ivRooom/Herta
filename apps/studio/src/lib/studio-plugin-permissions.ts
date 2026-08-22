import {
  evaluateStudioPolicyDocuments,
  evaluateStudioPolicyDocumentsDecision,
  mergeStudioPolicyDecisions,
  type StudioAccessPolicy,
  type StudioPolicyAction,
  type StudioPolicyDecision,
} from './studio-access-policy.ts';
import {
  configPathAncestorPaths,
  filterPluginConfigByReadablePaths,
} from './plugin-config-paths.ts';

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
  readableConfigPaths: string[];
  editableConfigPaths: string[];
  allConfigPathsReadable: boolean;
  allConfigPathsEditable: boolean;
}

export function pluginConfigFieldResource(
  guildId: string,
  pluginId: string,
  configPath: string,
): string {
  return `guild:${guildId}:plugin:${encodeSegment(pluginId)}:config:${encodeSegment(configPath)}`;
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

export function hasEffectivePluginConfigPermission(
  access: EffectivePluginPermissionContext,
  action: 'studio.settings.read' | 'studio.settings.write',
  guildId: string,
  pluginId: string,
  configPath: string,
): boolean {
  if (access.isRoot) return true;
  const policies = effectivePolicies(access);
  if (policies.length === 0) return true;

  let decision: StudioPolicyDecision = 'ImplicitDeny';
  for (const inheritedPath of configPathAncestorPaths(configPath)) {
    decision = mergeStudioPolicyDecisions(
      evaluateStudioPolicyDocumentsDecision(
        policies,
        action,
        pluginConfigFieldResource(guildId, pluginId, inheritedPath),
      ),
      decision,
    );
    if (decision === 'Deny') return false;
  }
  return decision === 'Allow';
}

export function resolvePluginConfigStudioAccess(
  access: EffectivePluginPermissionContext,
  guildId: string,
  pluginId: string,
  configPaths: readonly string[],
): PluginConfigStudioAccess {
  const uniqueConfigPaths = [...new Set(configPaths)];
  const enforceReadPolicy = hasConfiguredSettingsReadPolicy(access);
  const readableConfigPaths = enforceReadPolicy
    ? uniqueConfigPaths.filter((configPath) =>
        hasEffectivePluginConfigPermission(
          access,
          'studio.settings.read',
          guildId,
          pluginId,
          configPath,
        ),
      )
    : uniqueConfigPaths;
  const editableConfigPaths = uniqueConfigPaths.filter((configPath) =>
    hasEffectivePluginConfigPermission(
      access,
      'studio.settings.write',
      guildId,
      pluginId,
      configPath,
    ),
  );
  const topLevelKeys = uniqueTopLevelKeys(uniqueConfigPaths);
  const readableTopLevelKeys = new Set(readableConfigPaths.map(topLevelConfigKey));
  const editablePathSet = new Set(editableConfigPaths);

  return {
    canToggleEnabled: hasEffectivePluginPermission(
      access,
      'studio.operation.execute',
      pluginEnabledControlResource(guildId, pluginId),
    ),
    readableFieldKeys: topLevelKeys.filter((key) => readableTopLevelKeys.has(key)),
    // Whole-field editing can replace child values, so only expose the legacy top-level editor
    // when the top-level resource itself is writable. Child-only permissions use path patches.
    editableFieldKeys: topLevelKeys.filter((key) => editablePathSet.has(key)),
    readableConfigPaths,
    editableConfigPaths,
    allConfigPathsReadable: readableConfigPaths.length === uniqueConfigPaths.length,
    allConfigPathsEditable: editableConfigPaths.length === uniqueConfigPaths.length,
  };
}

export function filterReadablePluginConfig(
  config: Record<string, unknown>,
  access: Pick<PluginConfigStudioAccess, 'readableFieldKeys' | 'readableConfigPaths'>,
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  if (schema) {
    const readablePaths = new Set(access.readableConfigPaths);
    return filterPluginConfigByReadablePaths(config, schema, (path) => readablePaths.has(path));
  }
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

function uniqueTopLevelKeys(configPaths: readonly string[]): string[] {
  return [...new Set(configPaths.map(topLevelConfigKey).filter(Boolean))];
}

function topLevelConfigKey(configPath: string): string {
  const first = configPath.split('.', 1)[0] ?? '';
  return first.endsWith('[]') ? first.slice(0, -2) : first;
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
