export const RULE_STUDIO_SCHEMA_VERSION = 1 as const;
export const RULE_STUDIO_TRIGGER_TYPES = ['schedule.minute', 'member.joined'] as const;
export const RULE_STUDIO_ACTION_TYPES = [
  'discord.role.create',
  'discord.role.create-temporary',
  'discord.role.delete',
  'discord.member.role.add',
] as const;

export type RuleStudioTriggerType = (typeof RULE_STUDIO_TRIGGER_TYPES)[number];
export type RuleStudioActionType = (typeof RULE_STUDIO_ACTION_TYPES)[number];

export interface RuleStudioDraft {
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  triggerType: RuleStudioTriggerType;
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
  trigger:
    | { type: 'schedule.minute'; config: { everyMinutes: number; offsetMinutes: number } }
    | { type: 'member.joined'; config: Record<string, never> };
  conditions: Array<{ type: 'schedule.utc-hour-is'; config: { hour: number } }>;
  actions: Array<
    | { type: 'discord.role.create'; config: { roleName: string; roleColor: number } }
    | {
        type: 'discord.role.create-temporary';
        config: { roleName: string; roleColor: number; expiresAfterSeconds: number };
      }
    | { type: 'discord.role.delete'; config: { roleId: string } }
    | { type: 'discord.member.role.add'; config: { roleId: string } }
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
  { valid: true; definition: ValidatedRuleStudioDefinition } | { valid: false; errors: string[] };

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const MAX_INT = 2_147_483_647;

export function validateRuleStudioDraft(value: unknown): RuleStudioValidationResult {
  if (!isRecord(value)) {
    return { valid: false, errors: ['Rule設定はJSONオブジェクトで指定してください'] };
  }

  const errors: string[] = [];
  const name = stringValue(value.name).trim();
  const description = stringValue(value.description).trim();
  const enabled = value.enabled === true;
  const priority = integerValue(value.priority);
  const triggerType = stringValue(value.triggerType);
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
  if (!RULE_STUDIO_TRIGGER_TYPES.includes(triggerType as RuleStudioTriggerType))
    errors.push('未対応のTriggerです');
  if (triggerType === 'schedule.minute') {
    if (everyMinutes === null || everyMinutes < 1 || everyMinutes > 1440)
      errors.push('実行間隔は1〜1440分で指定してください');
    if (
      offsetMinutes === null ||
      offsetMinutes < 0 ||
      everyMinutes === null ||
      offsetMinutes >= everyMinutes
    )
      errors.push('offsetMinutesは0以上かつ実行間隔未満で指定してください');
    if (conditionHour !== null && (conditionHour < 0 || conditionHour > 23))
      errors.push('UTC時刻条件は0〜23時で指定してください');
  } else if (triggerType === 'member.joined' && conditionHour !== null) {
    errors.push('member.joinedではUTC時刻条件を指定できません');
  }
  if (!RULE_STUDIO_ACTION_TYPES.includes(actionType as RuleStudioActionType))
    errors.push('未対応のActionです');
  if (cooldownMs === null || cooldownMs < 0 || cooldownMs > MAX_INT)
    errors.push('cooldownは0〜2147483647msで指定してください');
  if (maxExecutions !== null && (maxExecutions < 1 || maxExecutions > MAX_INT))
    errors.push('最大実行回数は1〜2147483647で指定してください');

  if (actionType === 'discord.role.create' || actionType === 'discord.role.create-temporary') {
    if (roleName.length < 1 || roleName.length > 100)
      errors.push('作成Role名は1〜100文字で指定してください');
    if (roleColor === null || roleColor < 0 || roleColor > 0xffffff)
      errors.push('Role色は0〜16777215で指定してください');
  }
  if (actionType === 'discord.role.create-temporary') {
    if (
      expiresAfterSeconds === null ||
      expiresAfterSeconds < 60 ||
      expiresAfterSeconds > 31_536_000
    )
      errors.push('一時Roleの有効期間は60〜31536000秒で指定してください');
  }
  if (
    (actionType === 'discord.role.delete' || actionType === 'discord.member.role.add') &&
    !DISCORD_ID_PATTERN.test(roleId)
  ) {
    errors.push('対象Role IDが不正です');
  }
  if (actionType === 'discord.member.role.add' && triggerType !== 'member.joined') {
    errors.push('Role自動付与Actionはmember.joined Triggerでのみ利用できます');
  }

  if (
    errors.length > 0 ||
    priority === null ||
    cooldownMs === null ||
    (triggerType === 'schedule.minute' && (everyMinutes === null || offsetMinutes === null))
  ) {
    return { valid: false, errors };
  }

  const trigger: ValidatedRuleStudioDefinition['trigger'] =
    triggerType === 'member.joined'
      ? { type: 'member.joined', config: {} }
      : {
          type: 'schedule.minute',
          config: { everyMinutes: everyMinutes ?? 60, offsetMinutes: offsetMinutes ?? 0 },
        };
  const conditions: ValidatedRuleStudioDefinition['conditions'] =
    trigger.type === 'schedule.minute' && conditionHour !== null
      ? [{ type: 'schedule.utc-hour-is', config: { hour: conditionHour } }]
      : [];
  const base = {
    name,
    description: description || null,
    enabled,
    priority,
    schemaVersion: RULE_STUDIO_SCHEMA_VERSION,
    trigger,
    conditions,
    cooldownMs,
    maxExecutions,
  };

  if (actionType === 'discord.role.delete' || actionType === 'discord.member.role.add') {
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
            config: {
              roleName,
              roleColor: roleColor ?? 0,
              expiresAfterSeconds: expiresAfterSeconds ?? 60,
            },
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
  if (!isRecord(value.trigger) || !isRecord(value.trigger.config)) return null;
  const triggerType = value.trigger.type;
  if (!RULE_STUDIO_TRIGGER_TYPES.includes(triggerType as RuleStudioTriggerType)) return null;
  if (!Array.isArray(value.conditions) || value.conditions.length > 1) return null;
  if (!Array.isArray(value.actions) || value.actions.length !== 1 || !isRecord(value.actions[0]))
    return null;

  const condition = value.conditions[0];
  if (triggerType === 'member.joined' && condition !== undefined) return null;
  if (
    triggerType === 'schedule.minute' &&
    condition !== undefined &&
    (!isRecord(condition) ||
      condition.type !== 'schedule.utc-hour-is' ||
      !isRecord(condition.config))
  )
    return null;
  const action = value.actions[0];
  if (!isRecord(action.config)) return null;

  const scheduleConditionConfig =
    triggerType === 'schedule.minute' && isRecord(condition) && isRecord(condition.config)
      ? condition.config
      : null;
  const draft = {
    name: value.name,
    description: value.description ?? '',
    enabled: value.enabled,
    priority: value.priority,
    triggerType,
    everyMinutes: triggerType === 'schedule.minute' ? value.trigger.config.everyMinutes : 60,
    offsetMinutes: triggerType === 'schedule.minute' ? value.trigger.config.offsetMinutes : 0,
    conditionHour: scheduleConditionConfig?.hour ?? null,
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
    triggerType: validation.definition.trigger.type,
    actionType: validation.definition.actions[0].type,
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
