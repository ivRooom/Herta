export const RULE_STUDIO_SCHEMA_VERSION = 1 as const;
export const RULE_STUDIO_ACTION_TYPES = [
  'discord.role.create',
  'discord.role.create-temporary',
  'discord.role.delete',
] as const;

export type RuleStudioActionType = (typeof RULE_STUDIO_ACTION_TYPES)[number];

export interface RuleStudioDraft {
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  everyMinutes: number;
  offsetMinutes: number;
  conditionHour: number | null;
  actionType: RuleStudioActionType;
  roleName: string;
  roleColor: number;
  expiresAfterSeconds: number;
  roleId: string;
  cooldownMs: number;
  maxExecutions: number | null;
}

export interface ValidatedRuleStudioDefinition {
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  schemaVersion: typeof RULE_STUDIO_SCHEMA_VERSION;
  trigger: { type: 'schedule.minute'; config: { everyMinutes: number; offsetMinutes: number } };
  conditions: Array<{ type: 'schedule.utc-hour-is'; config: { hour: number } }>;
  actions: Array<
    | { type: 'discord.role.create'; config: { roleName: string; roleColor: number } }
    | {
        type: 'discord.role.create-temporary';
        config: { roleName: string; roleColor: number; expiresAfterSeconds: number };
      }
    | { type: 'discord.role.delete'; config: { roleId: string } }
  >;
  cooldownMs: number;
  maxExecutions: number | null;
}

export interface RuleStudioView extends RuleStudioDraft {
  id: string;
  executionCount: number;
  updatedAt: string;
}

export type RuleStudioValidationResult =
  | { valid: true; definition: ValidatedRuleStudioDefinition }
  | { valid: false; errors: string[] };

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const MAX_INT = 2_147_483_647;

export function validateRuleStudioDraft(value: unknown): RuleStudioValidationResult {
  if (!isRecord(value)) return { valid: false, errors: ['Rule設定はJSONオブジェクトで指定してください'] };

  const errors: string[] = [];
  const name = stringValue(value.name).trim();
  const description = stringValue(value.description).trim();
  const enabled = value.enabled === true;
  const priority = integerValue(value.priority);
  const everyMinutes = integerValue(value.everyMinutes);
  const offsetMinutes = integerValue(value.offsetMinutes);
  const conditionHour = value.conditionHour === null ? null : integerValue(value.conditionHour);
  const actionType = stringValue(value.actionType);
  const roleName = stringValue(value.roleName).trim();
  const roleColor = integerValue(value.roleColor);
  const expiresAfterSeconds = integerValue(value.expiresAfterSeconds);
  const roleId = stringValue(value.roleId).trim();
  const cooldownMs = integerValue(value.cooldownMs);
  const maxExecutions = value.maxExecutions === null ? null : integerValue(value.maxExecutions);

  if (name.length < 1 || name.length > 100) errors.push('Rule名は1〜100文字で指定してください');
  if (description.length > 500) errors.push('説明は500文字以内で指定してください');
  if (priority === null || priority < -10_000 || priority > 10_000)
    errors.push('priorityは-10000〜10000の整数で指定してください');
  if (everyMinutes === null || everyMinutes < 1 || everyMinutes > 1440)
    errors.push('実行間隔は1〜1440分で指定してください');
  if (
    offsetMinutes === null ||
    offsetMinutes < 0 ||
    everyMinutes === null ||
    offsetMinutes >= everyMinutes
  )
    errors.push('offsetMinutesは0以上かつ実行間隔未満で指定してください');
  if (conditionHour !== null && (conditionHour === null || conditionHour < 0 || conditionHour > 23))
    errors.push('UTC時刻条件は0〜23時で指定してください');
  if (!RULE_STUDIO_ACTION_TYPES.includes(actionType as RuleStudioActionType))
    errors.push('未対応のActionです');
  if (cooldownMs === null || cooldownMs < 0 || cooldownMs > MAX_INT)
    errors.push('cooldownは0〜2147483647msで指定してください');
  if (maxExecutions !== null && (maxExecutions === null || maxExecutions < 1 || maxExecutions > MAX_INT))
    errors.push('最大実行回数は1〜2147483647で指定してください');

  if (actionType === 'discord.role.create' || actionType === 'discord.role.create-temporary') {
    if (roleName.length < 1 || roleName.length > 100) errors.push('作成Role名は1〜100文字で指定してください');
    if (roleColor === null || roleColor < 0 || roleColor > 0xffffff)
      errors.push('Role色は0〜16777215で指定してください');
  }
  if (actionType === 'discord.role.create-temporary') {
    if (expiresAfterSeconds === null || expiresAfterSeconds < 60 || expiresAfterSeconds > 31_536_000)
      errors.push('一時Roleの有効期間は60〜31536000秒で指定してください');
  }
  if (actionType === 'discord.role.delete' && !DISCORD_ID_PATTERN.test(roleId))
    errors.push('削除対象Role IDが不正です');

  if (errors.length > 0 || priority === null || everyMinutes === null || offsetMinutes === null || cooldownMs === null) {
    return { valid: false, errors };
  }

  const base = {
    name,
    description: description || null,
    enabled,
    priority,
    schemaVersion: RULE_STUDIO_SCHEMA_VERSION,
    trigger: { type: 'schedule.minute' as const, config: { everyMinutes, offsetMinutes } },
    conditions:
      conditionHour === null
        ? []
        : [{ type: 'schedule.utc-hour-is' as const, config: { hour: conditionHour } }],
    cooldownMs,
    maxExecutions,
  };

  if (actionType === 'discord.role.delete') {
    return {
      valid: true,
      definition: { ...base, actions: [{ type: actionType, config: { roleId } }] },
    };
  }
  if (actionType === 'discord.role.create-temporary') {
    return {
      valid: true,
      definition: {
        ...base,
        actions: [
          {
            type: actionType,
            config: { roleName, roleColor: roleColor ?? 0, expiresAfterSeconds: expiresAfterSeconds ?? 60 },
          },
        ],
      },
    };
  }
  return {
    valid: true,
    definition: {
      ...base,
      actions: [{ type: 'discord.role.create', config: { roleName, roleColor: roleColor ?? 0 } }],
    },
  };
}

export function parseStoredRuleStudioView(value: {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  schemaVersion: number;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  cooldownMs: number;
  maxExecutions: number | null;
  executionCount: number;
  updatedAt: Date;
}): RuleStudioView | null {
  if (value.schemaVersion !== RULE_STUDIO_SCHEMA_VERSION) return null;
  if (!isRecord(value.trigger) || value.trigger.type !== 'schedule.minute' || !isRecord(value.trigger.config)) return null;
  if (!Array.isArray(value.conditions) || value.conditions.length > 1) return null;
  if (!Array.isArray(value.actions) || value.actions.length !== 1 || !isRecord(value.actions[0])) return null;

  const condition = value.conditions[0];
  if (condition !== undefined && (!isRecord(condition) || condition.type !== 'schedule.utc-hour-is' || !isRecord(condition.config))) return null;
  const action = value.actions[0];
  if (!isRecord(action.config)) return null;

  const draft = {
    name: value.name,
    description: value.description ?? '',
    enabled: value.enabled,
    priority: value.priority,
    everyMinutes: value.trigger.config.everyMinutes,
    offsetMinutes: value.trigger.config.offsetMinutes,
    conditionHour: condition === undefined ? null : condition.config.hour,
    actionType: action.type,
    roleName: action.config.roleName ?? '',
    roleColor: action.config.roleColor ?? 0,
    expiresAfterSeconds: action.config.expiresAfterSeconds ?? 3600,
    roleId: action.config.roleId ?? '',
    cooldownMs: value.cooldownMs,
    maxExecutions: value.maxExecutions,
  };
  const validation = validateRuleStudioDraft(draft);
  if (!validation.valid) return null;
  return {
    id: value.id,
    ...draft,
    actionType: validation.definition.actions[0].type,
    everyMinutes: validation.definition.trigger.config.everyMinutes,
    offsetMinutes: validation.definition.trigger.config.offsetMinutes,
    conditionHour:
      validation.definition.conditions[0]?.type === 'schedule.utc-hour-is'
        ? validation.definition.conditions[0].config.hour
        : null,
    executionCount: value.executionCount,
    updatedAt: value.updatedAt.toISOString(),
  } as RuleStudioView;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integerValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
