from pathlib import Path
import re

runtime = Path('apps/bot/src/rules/runtime.ts')
if "RULE_TRIGGER_MEMBER_JOINED = 'member.joined'" in runtime.read_text():
    print('member.joined patch already applied')
    raise SystemExit(0)


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor not found: {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1))

replace(
    'apps/bot/src/rules/runtime.ts',
    "export const RULE_TRIGGER_SCHEDULE_MINUTE = 'schedule.minute';\n",
    "export const RULE_TRIGGER_SCHEDULE_MINUTE = 'schedule.minute';\nexport const RULE_TRIGGER_MEMBER_JOINED = 'member.joined';\n",
)
replace(
    'apps/bot/src/rules/runtime.ts',
    "  async close(): Promise<void> {\n",
    "  async dispatchMemberJoined(input: { guildId: string; userId: string; joinedAt: Date }): Promise<void> {\n    if (this.closed) return;\n    assertSnowflake(input.guildId, 'guildId');\n    assertSnowflake(input.userId, 'userId');\n    assertValidDate(input.joinedAt, 'joinedAt');\n    const triggerExecutionId = `member-joined:${input.guildId}:${input.userId}:${input.joinedAt.getTime()}`;\n    await this.dispatch(\n      {\n        type: RULE_TRIGGER_MEMBER_JOINED,\n        guildId: input.guildId,\n        data: { userId: input.userId },\n        timestamp: input.joinedAt,\n      },\n      triggerExecutionId,\n    );\n  }\n\n  async close(): Promise<void> {\n",
)
replace(
    'apps/bot/src/rules/runtime.ts',
    "    this.conditions.register({\n      type: RULE_CONDITION_UTC_HOUR_IS,",
    "    this.triggers.register({\n      type: RULE_TRIGGER_MEMBER_JOINED,\n      name: 'Member joined',\n      description: 'Discord GuildMemberAddを評価するproduction trigger',\n      configSchema: {},\n      evaluate: async (event) => event.type === RULE_TRIGGER_MEMBER_JOINED,\n    });\n\n    this.conditions.register({\n      type: RULE_CONDITION_UTC_HOUR_IS,",
)

replace(
    'apps/bot/src/rules/runtime.test.ts',
    "  RULE_TRIGGER_SCHEDULE_MINUTE,\n",
    "  RULE_TRIGGER_MEMBER_JOINED,\n  RULE_TRIGGER_SCHEDULE_MINUTE,\n",
)
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "  it('同一minuteはprocess内で再評価せず、再配送claimでもRoleを重複作成しない', async () => {",
    "  it('member.joined production triggerからRole create Operationを生成し再配送をdedupeする', async () => {\n    const joinedAt = new Date('2026-08-17T11:59:58.000Z');\n    const harness = createHarness({\n      rules: [storedRule({ trigger: { type: RULE_TRIGGER_MEMBER_JOINED, config: {} } })],\n    });\n\n    await harness.runtime.dispatchMemberJoined({ guildId: GUILD_ID, userId: ACTOR_ID, joinedAt });\n    await harness.runtime.dispatchMemberJoined({ guildId: GUILD_ID, userId: ACTOR_ID, joinedAt });\n\n    expect(harness.enqueueRoleCreate).toHaveBeenCalledTimes(1);\n    expect(harness.recordExecution).toHaveBeenLastCalledWith(\n      expect.objectContaining({\n        triggerExecutionId: `member-joined:${GUILD_ID}:${ACTOR_ID}:${joinedAt.getTime()}`,\n        event: expect.objectContaining({\n          type: RULE_TRIGGER_MEMBER_JOINED,\n          guildId: GUILD_ID,\n          data: { userId: ACTOR_ID },\n        }),\n        result: expect.objectContaining({\n          actionsExecuted: false,\n          actionSkipReason: 'duplicate-event',\n        }),\n      }),\n    );\n  });\n\n  it('同一minuteはprocess内で再評価せず、再配送claimでもRoleを重複作成しない', async () => {",
)

replace(
    'apps/bot/src/bot.ts',
    "const BOT_ACTIVITY_TYPE_MAP: Record<BotPresenceConfig['activityType'], ActivityType> = {",
    "export interface RuleRuntimeEventSink {\n  memberJoined(input: { guildId: string; userId: string; joinedAt: Date }): Promise<void>;\n}\n\nconst BOT_ACTIVITY_TYPE_MAP: Record<BotPresenceConfig['activityType'], ActivityType> = {",
)
replace(
    'apps/bot/src/bot.ts',
    "  private readonly activityMessageLastCountedAt = new Map<string, number>();\n",
    "  private readonly activityMessageLastCountedAt = new Map<string, number>();\n  private ruleRuntimeEvents?: RuleRuntimeEventSink;\n",
)
replace(
    'apps/bot/src/bot.ts',
    "    this.setupEventHandlers();\n  }\n\n  private setupEventHandlers(): void {",
    "    this.setupEventHandlers();\n  }\n\n  setRuleRuntimeEventSink(sink: RuleRuntimeEventSink | undefined): void {\n    this.ruleRuntimeEvents = sink;\n  }\n\n  private setupEventHandlers(): void {",
)
replace(
    'apps/bot/src/bot.ts',
    "    this.client.on(Events.GuildMemberAdd, async (member) => {\n      await this.dispatchGuildPluginEvent(member.guild.id, Events.GuildMemberAdd, member);\n    });",
    "    this.client.on(Events.GuildMemberAdd, async (member) => {\n      await this.dispatchGuildPluginEvent(member.guild.id, Events.GuildMemberAdd, member);\n      if (member.user.bot || !this.ruleRuntimeEvents) return;\n      if (member.joinedTimestamp === null) {\n        this.logger.warn(\n          { guildId: member.guild.id, userId: member.id },\n          'member.joined Ruleの安定したexecution IDを作れないため実行をスキップしました',\n        );\n        return;\n      }\n      try {\n        await this.ruleRuntimeEvents.memberJoined({\n          guildId: member.guild.id,\n          userId: member.id,\n          joinedAt: new Date(member.joinedTimestamp),\n        });\n      } catch (error) {\n        this.logger.error(\n          { err: error, guildId: member.guild.id, userId: member.id },\n          'member.joined Ruleの実行に失敗しました',\n        );\n      }\n    });",
)
replace(
    'apps/bot/src/bot.ts',
    "logger.info('Moderationブラックリスト再参加監視用Guild Members Intentを有効化します');",
    "logger.info('Moderation / member.joined Rule用Guild Members Intentを有効化します');",
)
replace(
    'apps/bot/src/bot.ts',
    "'DISCORD_ENABLE_GUILD_MEMBERS_INTENTが無効なためブラックリスト再参加BANは実行されません',",
    "'DISCORD_ENABLE_GUILD_MEMBERS_INTENTが無効なためブラックリスト再参加BAN / member.joined Ruleは実行されません',",
)

replace(
    'apps/bot/src/main.ts',
    "  : undefined;\nconst version = process.env['HERTA_VERSION']?.trim() || '0.1.0';",
    "  : undefined;\n\nbot.setRuleRuntimeEventSink(\n  ruleRuntime\n    ? { memberJoined: (input) => ruleRuntime.dispatchMemberJoined(input) }\n    : undefined,\n);\n\nconst version = process.env['HERTA_VERSION']?.trim() || '0.1.0';",
)

Path('apps/studio/src/lib/rule-studio.ts').write_text(r'''export const RULE_STUDIO_SCHEMA_VERSION = 1 as const;
export const RULE_STUDIO_TRIGGER_TYPES = ['schedule.minute', 'member.joined'] as const;
export const RULE_STUDIO_ACTION_TYPES = [
  'discord.role.create',
  'discord.role.create-temporary',
  'discord.role.delete',
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
    | { type: 'discord.role.create-temporary'; config: { roleName: string; roleColor: number; expiresAfterSeconds: number } }
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
    if (offsetMinutes === null || offsetMinutes < 0 || everyMinutes === null || offsetMinutes >= everyMinutes)
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
    if (expiresAfterSeconds === null || expiresAfterSeconds < 60 || expiresAfterSeconds > 31_536_000)
      errors.push('一時Roleの有効期間は60〜31536000秒で指定してください');
  }
  if (actionType === 'discord.role.delete' && !DISCORD_ID_PATTERN.test(roleId))
    errors.push('削除対象Role IDが不正です');

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

  if (actionType === 'discord.role.delete') {
    return { valid: true, definition: { ...base, actions: [{ type: actionType, config: { roleId } }] } };
  }
  if (actionType === 'discord.role.create-temporary') {
    return {
      valid: true,
      definition: {
        ...base,
        actions: [{
          type: actionType,
          config: {
            roleName,
            roleColor: roleColor ?? 0,
            expiresAfterSeconds: expiresAfterSeconds ?? 60,
          },
        }],
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
  if (!Array.isArray(value.actions) || value.actions.length !== 1 || !isRecord(value.actions[0])) return null;

  const condition = value.conditions[0];
  if (triggerType === 'member.joined' && condition !== undefined) return null;
  if (
    triggerType === 'schedule.minute' &&
    condition !== undefined &&
    (!isRecord(condition) || condition.type !== 'schedule.utc-hour-is' || !isRecord(condition.config))
  ) return null;
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
''')

p = Path('apps/studio/src/lib/rule-studio.test.ts')
text = p.read_text()
text = text.replace("  priority: 10,\n  everyMinutes: 60,", "  priority: 10,\n  triggerType: 'schedule.minute' as const,\n  everyMinutes: 60,", 1)
marker = "test('offset must be smaller than schedule interval', () => {"
block = """test('member.joined rule is normalized without schedule-only config', () => {\n  const result = validateRuleStudioDraft({\n    ...baseDraft,\n    triggerType: 'member.joined',\n    everyMinutes: 0,\n    offsetMinutes: -1,\n    conditionHour: null,\n  });\n  assert.equal(result.valid, true);\n  if (!result.valid) return;\n  assert.deepEqual(result.definition.trigger, { type: 'member.joined', config: {} });\n  assert.deepEqual(result.definition.conditions, []);\n});\n\ntest('member.joined rejects schedule-only UTC condition', () => {\n  const result = validateRuleStudioDraft({ ...baseDraft, triggerType: 'member.joined', conditionHour: 12 });\n  assert.equal(result.valid, false);\n});\n\ntest('member.joined stored rule is exposed as editable', () => {\n  const result = parseStoredRuleStudioView({\n    id: '11111111-1111-4111-8111-111111111111',\n    name: 'Join event',\n    description: null,\n    enabled: true,\n    priority: 0,\n    schemaVersion: 1,\n    trigger: { type: 'member.joined', config: {} },\n    conditions: [],\n    actions: [{ type: 'discord.role.create', config: { roleName: 'joined', roleColor: 0 } }],\n    cooldownMs: 0,\n    maxExecutions: null,\n    executionCount: 0,\n    updatedAt: new Date('2026-08-17T00:00:00.000Z'),\n  });\n  assert.equal(result?.triggerType, 'member.joined');\n});\n\n"""
if marker not in text:
    raise SystemExit('rule-studio test marker missing')
p.write_text(text.replace(marker, block + marker, 1))

replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "import { Clock3, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react';\nimport type { RuleStudioActionType, RuleStudioView } from '@/lib/rule-studio';",
    "import { Clock3, Plus, Save, ShieldAlert, Trash2, UserPlus } from 'lucide-react';\nimport type { RuleStudioActionType, RuleStudioTriggerType, RuleStudioView } from '@/lib/rule-studio';",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "  priority: 0,\n  everyMinutes: 60,",
    "  priority: 0,\n  triggerType: 'schedule.minute' as RuleStudioTriggerType,\n  everyMinutes: 60,",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "  function startNew() {",
    "  function changeTriggerType(triggerType: RuleStudioTriggerType) {\n    setDraft((current) => ({\n      ...current,\n      triggerType,\n      conditionHour: triggerType === 'schedule.minute' ? current.conditionHour : null,\n    }));\n    setNotice(null);\n  }\n\n  function startNew() {",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    'Production runtimeで対応済みのSchedule TriggerとDiscord Role ActionをGUIで設定します。',
    'Production runtimeで対応済みのSchedule / Member joined TriggerとDiscord Role ActionをGUIで設定します。',
)
component = Path('apps/studio/src/components/rule-studio-manager.tsx')
text = component.read_text()
start = text.index('            <div className="rounded-xl border border-border bg-background p-4">\n              <div className="flex items-center gap-2">\n                <Clock3')
end = text.index('            <div className="rounded-xl border border-border bg-background p-4">\n              <h3 className="font-semibold">Action</h3>', start)
trigger_ui = '''            <div className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center gap-2">
                {draft.triggerType === 'schedule.minute' ? (
                  <Clock3 className="h-4 w-4 text-primary" aria-hidden="true" />
                ) : (
                  <UserPlus className="h-4 w-4 text-primary" aria-hidden="true" />
                )}
                <h3 className="font-semibold">Trigger</h3>
              </div>
              <div className="mt-4 max-w-sm">
                <Field label="Trigger種別">
                  <select
                    value={draft.triggerType}
                    onChange={(event) => changeTriggerType(event.target.value as RuleStudioTriggerType)}
                    className={inputClass}
                  >
                    <option value="schedule.minute">Schedule</option>
                    <option value="member.joined">Member joined</option>
                  </select>
                </Field>
              </div>
              {draft.triggerType === 'schedule.minute' ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <Field label="実行間隔（分）">
                    <input type="number" min={1} max={1440} value={draft.everyMinutes} onChange={(event) => patch('everyMinutes', Number(event.target.value))} className={inputClass} />
                  </Field>
                  <Field label="Offset（分）">
                    <input type="number" min={0} max={Math.max(0, draft.everyMinutes - 1)} value={draft.offsetMinutes} onChange={(event) => patch('offsetMinutes', Number(event.target.value))} className={inputClass} />
                  </Field>
                  <Field label="UTC時刻条件（任意）">
                    <select value={draft.conditionHour === null ? '' : String(draft.conditionHour)} onChange={(event) => patch('conditionHour', event.target.value === '' ? null : Number(event.target.value))} className={inputClass}>
                      <option value="">指定なし</option>
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>{hour}:00 UTC</option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-blue-500/25 bg-blue-500/5 p-3 text-sm leading-6 text-muted">
                  <p className="font-semibold text-foreground">新しいメンバーがGuildへ参加したときに実行します。</p>
                  <p className="mt-1">BotでGuild Members Intentが有効な環境で動作します。Message Content Intentは不要です。</p>
                </div>
              )}
            </div>

'''
component.write_text(text[:start] + trigger_ui + text[end:])

replace(
    'apps/studio/src/app/api/guilds/[guildId]/rules/route.ts',
    "{ error: 'このRuleはRule Studio v1の編集対象外です' },",
    "{ error: 'このRuleは現在のRule Studio編集対象外です' },",
)

print('member.joined source patch applied')
