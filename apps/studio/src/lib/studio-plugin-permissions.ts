import type { StudioAccessPolicy, StudioPolicyAction } from './studio-access-policy';

export type ExplicitPermissionMode = 'inherit' | 'allow' | 'deny';

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
