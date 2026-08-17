import { HERTA_STUDIO_ROOT_DISCORD_ROLE_ID } from '@herta/shared';
import { z } from 'zod';

export const STUDIO_ROOT_DISCORD_ROLE_ID = HERTA_STUDIO_ROOT_DISCORD_ROLE_ID;
export const STUDIO_ACCESS_POLICY_VERSION = '2026-08-17';
export const STUDIO_GUI_PERMISSION_SID = 'StudioGuiPermissions';

export const STUDIO_POLICY_ACTIONS = [
  'studio.page.view',
  'studio.settings.read',
  'studio.settings.write',
  'studio.resource.create',
  'studio.resource.update',
  'studio.resource.delete',
  'studio.operation.execute',
  'studio.roles.read',
  'studio.roles.manage',
  'studio.secrets.manage',
  'studio.commands.execute',
  'studio.ai.use',
  'studio.ai.manage',
  'studio.rag.manage',
  'studio.mcp.manage',
] as const;

export type StudioPolicyAction = (typeof STUDIO_POLICY_ACTIONS)[number];
export type StudioPolicyEffect = 'Allow' | 'Deny';

const policyStatementSchema = z.object({
  Sid: z.string().trim().min(1).max(64).optional(),
  Effect: z.enum(['Allow', 'Deny']),
  Action: z.array(z.string().trim().min(1).max(96)).min(1).max(64),
  Resource: z.array(z.string().trim().min(1).max(256)).min(1).max(64),
});

const studioAccessPolicySchema = z.object({
  Version: z.literal(STUDIO_ACCESS_POLICY_VERSION),
  Statement: z.array(policyStatementSchema).max(64),
});

export type StudioAccessPolicy = z.infer<typeof studioAccessPolicySchema>;
export type StudioAccessPolicyStatement = StudioAccessPolicy['Statement'][number];

export interface StudioPolicyValidationResult {
  valid: boolean;
  policy?: StudioAccessPolicy;
  errors: string[];
}

export interface StudioPolicyEvaluationInput {
  roleIds: readonly string[];
  policies: readonly { discordRoleId: string; policy: StudioAccessPolicy }[];
  action: StudioPolicyAction;
  resource: string;
}

export function createEmptyStudioAccessPolicy(): StudioAccessPolicy {
  return { Version: STUDIO_ACCESS_POLICY_VERSION, Statement: [] };
}

export function createStudioRolePolicyFromActions(
  guildId: string,
  actions: readonly StudioPolicyAction[],
): StudioAccessPolicy {
  return setStudioGuiActions(createEmptyStudioAccessPolicy(), guildId, actions);
}

export function setStudioGuiActions(
  policy: StudioAccessPolicy,
  guildId: string,
  actions: readonly StudioPolicyAction[],
): StudioAccessPolicy {
  const uniqueActions = [...new Set(actions)];
  const scopedStatements = policy.Statement.filter(
    (statement) => statement.Sid !== STUDIO_GUI_PERMISSION_SID,
  );
  if (uniqueActions.length === 0) return { ...policy, Statement: scopedStatements };

  return {
    ...policy,
    Statement: [
      {
        Sid: STUDIO_GUI_PERMISSION_SID,
        Effect: 'Allow',
        Action: uniqueActions,
        Resource: [`guild:${guildId}:*`],
      },
      ...scopedStatements,
    ],
  };
}

export function validateStudioAccessPolicy(
  value: unknown,
  guildId: string,
): StudioPolicyValidationResult {
  const parsed = studioAccessPolicySchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'policy'}: ${issue.message}`,
      ),
    };
  }

  const errors: string[] = [];
  for (const [statementIndex, statement] of parsed.data.Statement.entries()) {
    for (const action of statement.Action) {
      if (!isSupportedActionPattern(action)) {
        errors.push(`Statement.${statementIndex}.Action: 未対応のActionです (${action})`);
      }
    }
    for (const resource of statement.Resource) {
      if (!isGuildScopedResource(resource, guildId)) {
        errors.push(
          `Statement.${statementIndex}.Resource: このGuild外のResourceは指定できません (${resource})`,
        );
      }
    }
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, policy: parsed.data, errors: [] };
}

export function evaluateStudioAccessPolicy(input: StudioPolicyEvaluationInput): boolean {
  const activeRoleIds = new Set(input.roleIds);
  return evaluateStudioPolicyDocuments(
    input.policies
      .filter((rolePolicy) => activeRoleIds.has(rolePolicy.discordRoleId))
      .map((rolePolicy) => rolePolicy.policy),
    input.action,
    input.resource,
  );
}

export function evaluateStudioPolicyDocuments(
  policies: readonly StudioAccessPolicy[],
  action: StudioPolicyAction,
  resource: string,
): boolean {
  let allowed = false;

  for (const policy of policies) {
    for (const statement of policy.Statement) {
      if (!matchesAny(statement.Action, action)) continue;
      if (!matchesAny(statement.Resource, resource)) continue;
      if (statement.Effect === 'Deny') return false;
      allowed = true;
    }
  }

  return allowed;
}

export function isStudioRootRole(roleIds: readonly string[]): boolean {
  return roleIds.includes(STUDIO_ROOT_DISCORD_ROLE_ID);
}

export function policyContainsWildcardGrant(policy: StudioAccessPolicy): boolean {
  return policy.Statement.some(
    (statement) =>
      statement.Effect === 'Allow' && statement.Action.some((action) => action.includes('*')),
  );
}

function isSupportedActionPattern(action: string): boolean {
  if (action === '*') return true;
  if (!action.includes('*')) return (STUDIO_POLICY_ACTIONS as readonly string[]).includes(action);
  return /^studio(?:\.[a-z][a-z0-9-]*)*\.\*$/u.test(action);
}

function isGuildScopedResource(resource: string, guildId: string): boolean {
  return resource === `guild:${guildId}` || resource.startsWith(`guild:${guildId}:`);
}

function matchesAny(patterns: readonly string[], value: string): boolean {
  return patterns.some((pattern) => matchesGlob(pattern, value));
}

function matchesGlob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*');
  return new RegExp(`^${escaped}$`, 'u').test(value);
}
