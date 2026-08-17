import { createHash } from 'node:crypto';
import type {
  DiscordRoleOperationRecord,
  EnqueueDiscordRoleCreateInput,
  EnqueueDiscordRoleDeleteInput,
  RuleExecutionReservation,
  StoredRuleRuntimeRecord,
} from '@herta/db';
import {
  ActionRegistry,
  ConditionRegistry,
  RuleEvaluator,
  TriggerRegistry,
  type RuleActionContextInput,
  type RuleBeforeActionsInput,
} from '@herta/rule-engine';
import type { ActionResult, ConditionNode, RuleDefinition, TriggerEvent } from '@herta/shared';
import type { Logger } from '@herta/logger';

export const RULE_TRIGGER_SCHEDULE_MINUTE = 'schedule.minute';
export const RULE_TRIGGER_MEMBER_JOINED = 'member.joined';
export const RULE_ACTION_ROLE_CREATE = 'discord.role.create';
export const RULE_ACTION_ROLE_CREATE_TEMPORARY = 'discord.role.create-temporary';
export const RULE_ACTION_ROLE_DELETE = 'discord.role.delete';
export const RULE_CONDITION_UTC_HOUR_IS = 'schedule.utc-hour-is';

const RULE_SCHEMA_VERSION = 1;
const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const MAX_RULE_ACTIONS = 20;
const MAX_RULE_CONDITIONS = 32;
const MAX_CONDITION_DEPTH = 8;
const MAX_COOLDOWN_MS = 31 * 24 * 60 * 60 * 1_000;
const SCHEDULE_SCAN_INTERVAL_MS = 30_000;

export interface RuleRuntimeStore {
  listRules(guildId: string, triggerType: string): Promise<StoredRuleRuntimeRecord[]>;
  listGuildIdsWithTrigger(triggerType: string): Promise<string[]>;
  reserveExecution(input: {
    guildId: string;
    ruleId: string;
    triggerExecutionId: string;
    now: Date;
  }): Promise<RuleExecutionReservation>;
  recordExecution(input: {
    event: TriggerEvent;
    triggerExecutionId: string;
    result: Awaited<ReturnType<RuleEvaluator['evaluate']>>[number];
    executedAt?: Date;
  }): Promise<void>;
  recordInvalidRule(input: {
    guildId: string;
    ruleId: string;
    triggerType: string;
    triggerExecutionId: string;
    error: string;
    executedAt?: Date;
  }): Promise<void>;
  enqueueRoleCreate(input: EnqueueDiscordRoleCreateInput): Promise<DiscordRoleOperationRecord>;
  enqueueRoleDelete(input: EnqueueDiscordRoleDeleteInput): Promise<DiscordRoleOperationRecord>;
}

export interface RuleRuntimeSecurity {
  /** Rule作成者が現在もOWNER root Roleを持つことをlive Discord stateで検証する。 */
  authorizeRuleActor(guildId: string, actorId: string): Promise<boolean>;
  /** Bot Manage Roles権限をlive Discord stateで検証する。 */
  canCreateRole(guildId: string): Promise<boolean>;
  /** Guild境界・root Role保護・role hierarchyをlive Discord stateで検証する。 */
  canDeleteRole(guildId: string, roleId: string): Promise<boolean>;
}

export interface RuleProductionRuntimeOptions {
  store: RuleRuntimeStore;
  security: RuleRuntimeSecurity;
  logger: Logger;
  now?: () => Date;
}

interface RuntimeRuleMetadata {
  actorId: string;
}

interface RuleBaseContext {
  triggerExecutionId: string;
  data: Record<string, unknown>;
  metadata: Map<string, RuntimeRuleMetadata>;
}

interface RoleActionContext {
  guildId: string;
  triggerExecutionId: string;
  ruleId: string;
  actionIndex: number;
  actorId: string;
  eventTimestamp: Date;
}

interface ParsedCreateRoleConfig {
  roleName: string;
  roleColor: number;
  expiresAfterSeconds: number | null;
}

/**
 * Rule Engine v1 production runtime。
 * UTC minute tickをproduction triggerとして評価し、Discord mutationは直接行わず
 * PR #239のRole Lifecycle Operationだけをenqueueする。
 */
export class RuleProductionRuntime {
  private readonly triggers = new TriggerRegistry();
  private readonly conditions = new ConditionRegistry();
  private readonly actions = new ActionRegistry();
  private readonly evaluator: RuleEvaluator;
  private readonly now: () => Date;
  private scheduleTimer?: NodeJS.Timeout;
  private scheduleRun?: Promise<void>;
  private lastScheduleMinute: number | null = null;
  private closed = false;

  constructor(private readonly options: RuleProductionRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
    this.registerDefinitions();
    this.evaluator = new RuleEvaluator({
      triggers: this.triggers,
      conditions: this.conditions,
      actions: this.actions,
      beforeActions: (input) => this.beforeActions(input),
      createActionContext: (input) => this.createActionContext(input),
    });
  }

  async start(): Promise<void> {
    if (this.closed || this.scheduleTimer) return;
    await this.scanNow();
    this.scheduleTimer = setInterval(() => {
      void this.scanNow().catch((error) => {
        this.options.logger.error(
          { errorName: resolveErrorName(error) },
          'Rule Engine schedule scanに失敗しました',
        );
      });
    }, SCHEDULE_SCAN_INTERVAL_MS);
    this.scheduleTimer.unref();
  }

  async scanNow(at = this.now()): Promise<void> {
    if (this.closed) return;
    assertValidDate(at, 'at');
    const minuteEpoch = Math.floor(at.getTime() / 60_000);
    if (this.lastScheduleMinute === minuteEpoch) return;
    if (this.scheduleRun) return this.scheduleRun;

    this.lastScheduleMinute = minuteEpoch;
    const run = this.dispatchScheduleMinute(minuteEpoch).finally(() => {
      if (this.scheduleRun === run) this.scheduleRun = undefined;
    });
    this.scheduleRun = run;
    return run;
  }

  async dispatchMemberJoined(input: {
    guildId: string;
    userId: string;
    joinedAt: Date;
  }): Promise<void> {
    if (this.closed) return;
    assertSnowflake(input.guildId, 'guildId');
    assertSnowflake(input.userId, 'userId');
    assertValidDate(input.joinedAt, 'joinedAt');
    const triggerExecutionId = `member-joined:${input.guildId}:${input.userId}:${input.joinedAt.getTime()}`;
    await this.dispatch(
      {
        type: RULE_TRIGGER_MEMBER_JOINED,
        guildId: input.guildId,
        data: { userId: input.userId },
        timestamp: input.joinedAt,
      },
      triggerExecutionId,
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = undefined;
    await this.scheduleRun?.catch(() => undefined);
  }

  private async dispatchScheduleMinute(minuteEpoch: number): Promise<void> {
    const timestamp = new Date(minuteEpoch * 60_000);
    const executionId = `schedule-minute:${minuteEpoch}`;
    const guildIds = await this.options.store.listGuildIdsWithTrigger(RULE_TRIGGER_SCHEDULE_MINUTE);
    for (const guildId of guildIds) {
      try {
        await this.dispatch(
          {
            type: RULE_TRIGGER_SCHEDULE_MINUTE,
            guildId,
            data: {
              minuteEpoch,
              utcHour: timestamp.getUTCHours(),
              utcMinute: timestamp.getUTCMinutes(),
            },
            timestamp,
          },
          executionId,
        );
      } catch (error) {
        this.options.logger.error(
          { guildId, errorName: resolveErrorName(error) },
          'Guildのschedule Rule実行に失敗しました',
        );
      }
    }
  }

  private async dispatch(event: TriggerEvent, triggerExecutionId: string): Promise<void> {
    const stored = await this.options.store.listRules(event.guildId, event.type);
    if (stored.length === 0) return;

    const metadata = new Map<string, RuntimeRuleMetadata>();
    const rules: Array<RuleDefinition & { id: string }> = [];
    for (const record of stored) {
      try {
        const parsed = parseStoredRule(record);
        metadata.set(parsed.id, { actorId: record.createdBy });
        rules.push(parsed);
      } catch (error) {
        const errorName = resolveErrorName(error);
        this.options.logger.error(
          { guildId: event.guildId, ruleId: record.id, errorName },
          '保存済みRuleが不正なため実行を拒否しました',
        );
        await this.options.store.recordInvalidRule({
          guildId: event.guildId,
          ruleId: record.id,
          triggerType: event.type,
          triggerExecutionId,
          error: errorName,
          executedAt: this.now(),
        });
      }
    }
    if (rules.length === 0) return;

    const context: RuleBaseContext = { triggerExecutionId, data: event.data, metadata };
    const results = await this.evaluator.evaluate(event, rules, context);
    for (const result of results) {
      // trigger config不一致はnoiseを避けて記録しない。errorは必ず残す。
      if (!result.triggerMatched && !result.error) continue;
      try {
        await this.options.store.recordExecution({
          event,
          triggerExecutionId,
          result,
          executedAt: this.now(),
        });
      } catch (error) {
        this.options.logger.error(
          { guildId: event.guildId, ruleId: result.ruleId, errorName: resolveErrorName(error) },
          'Rule Execution Logの保存に失敗しました',
        );
      }
    }
  }

  private async beforeActions(input: RuleBeforeActionsInput) {
    const context = requireBaseContext(input.context);
    const metadata = context.metadata.get(input.rule.id);
    if (!metadata) return { allowed: false, reason: 'missing-rule-metadata' };

    const authorized = await this.options.security.authorizeRuleActor(
      input.event.guildId,
      metadata.actorId,
    );
    if (!authorized) return { allowed: false, reason: 'authorization-denied' };

    const reservation = await this.options.store.reserveExecution({
      guildId: input.event.guildId,
      ruleId: input.rule.id,
      triggerExecutionId: context.triggerExecutionId,
      now: this.now(),
    });
    return reservation.allowed ? { allowed: true } : { allowed: false, reason: reservation.reason };
  }

  private createActionContext(input: RuleActionContextInput): RoleActionContext {
    const context = requireBaseContext(input.context);
    const metadata = context.metadata.get(input.rule.id);
    if (!metadata) throw new Error('RuleRuntimeMetadataMissing');
    return {
      guildId: input.event.guildId,
      triggerExecutionId: context.triggerExecutionId,
      ruleId: input.rule.id,
      actionIndex: input.actionIndex,
      actorId: metadata.actorId,
      eventTimestamp: input.event.timestamp,
    };
  }

  private registerDefinitions(): void {
    this.triggers.register({
      type: RULE_TRIGGER_SCHEDULE_MINUTE,
      name: 'Schedule minute',
      description: 'UTC epoch minuteを基準に一定間隔で評価するproduction trigger',
      configSchema: { everyMinutes: 'integer 1..1440', offsetMinutes: 'integer >= 0' },
      evaluate: async (event, config) => {
        if (event.type !== RULE_TRIGGER_SCHEDULE_MINUTE) return false;
        const everyMinutes = parseInteger(config['everyMinutes'] ?? 1, 1, 1_440, 'everyMinutes');
        const offsetMinutes = parseInteger(
          config['offsetMinutes'] ?? 0,
          0,
          everyMinutes - 1,
          'offsetMinutes',
        );
        const minuteEpoch = Math.floor(event.timestamp.getTime() / 60_000);
        return (minuteEpoch - offsetMinutes) % everyMinutes === 0;
      },
    });

    this.triggers.register({
      type: RULE_TRIGGER_MEMBER_JOINED,
      name: 'Member joined',
      description: 'Discord GuildMemberAddを評価するproduction trigger',
      configSchema: {},
      evaluate: async (event) => event.type === RULE_TRIGGER_MEMBER_JOINED,
    });

    this.conditions.register({
      type: RULE_CONDITION_UTC_HOUR_IS,
      name: 'UTC hour is',
      description: 'schedule eventのUTC hourを0〜23で比較する',
      configSchema: { hour: 'integer 0..23' },
      evaluate: async (context, config) => {
        const base = requireBaseContext(context);
        const hour = parseInteger(config['hour'], 0, 23, 'hour');
        return base.data['utcHour'] === hour;
      },
    });

    this.actions.register({
      type: RULE_ACTION_ROLE_CREATE,
      name: 'Create Discord role',
      description: 'Role Lifecycle Operationへ作成をenqueueする',
      configSchema: { roleName: 'string', roleColor: '0..16777215?' },
      execute: (context, config) => this.executeRoleCreate(context, config, false),
    });

    this.actions.register({
      type: RULE_ACTION_ROLE_CREATE_TEMPORARY,
      name: 'Create temporary Discord role',
      description: '期限付きRole Lifecycle Operationをenqueueする',
      configSchema: {
        roleName: 'string',
        roleColor: '0..16777215?',
        expiresAfterSeconds: 'integer 60..31536000',
      },
      execute: (context, config) => this.executeRoleCreate(context, config, true),
    });

    this.actions.register({
      type: RULE_ACTION_ROLE_DELETE,
      name: 'Delete Discord role',
      description: 'Role Lifecycle Operationへ削除をenqueueする',
      configSchema: { roleId: 'Discord snowflake' },
      execute: (context, config) => this.executeRoleDelete(context, config),
    });
  }

  private async executeRoleCreate(
    context: unknown,
    config: Record<string, unknown>,
    temporary: boolean,
  ): Promise<ActionResult> {
    let actionContext: RoleActionContext;
    let parsed: ParsedCreateRoleConfig;
    try {
      actionContext = requireRoleActionContext(context);
      parsed = parseCreateRoleConfig(config, temporary);
    } catch (error) {
      return { success: false, error: resolveErrorName(error) };
    }

    if (!(await this.options.security.canCreateRole(actionContext.guildId))) {
      return { success: false, error: 'DiscordRoleCreateNotPermitted' };
    }

    const idempotency = deriveRoleCreateIdempotency({
      ruleId: actionContext.ruleId,
      triggerExecutionId: actionContext.triggerExecutionId,
      actionIndex: actionContext.actionIndex,
      actionType: temporary ? RULE_ACTION_ROLE_CREATE_TEMPORARY : RULE_ACTION_ROLE_CREATE,
      roleName: parsed.roleName,
      roleColor: parsed.roleColor,
      expiresAfterSeconds: parsed.expiresAfterSeconds,
      scheduledFor: actionContext.eventTimestamp,
    });

    try {
      const operation = await this.options.store.enqueueRoleCreate({
        guildId: actionContext.guildId,
        roleName: parsed.roleName,
        roleColor: parsed.roleColor,
        scheduledFor: actionContext.eventTimestamp,
        expiresAfterSeconds: parsed.expiresAfterSeconds,
        createdBy: actionContext.actorId,
        source: 'rule-engine',
        operationId: idempotency.operationId,
        idempotencyFingerprint: idempotency.fingerprint,
      });
      return {
        success: true,
        data: { operationId: operation.id, operationStatus: operation.status },
      };
    } catch (error) {
      return { success: false, error: resolveErrorName(error) };
    }
  }

  private async executeRoleDelete(
    context: unknown,
    config: Record<string, unknown>,
  ): Promise<ActionResult> {
    let actionContext: RoleActionContext;
    let roleId: string;
    try {
      actionContext = requireRoleActionContext(context);
      roleId = parseSnowflake(config['roleId'], 'roleId');
    } catch (error) {
      return { success: false, error: resolveErrorName(error) };
    }

    if (!(await this.options.security.canDeleteRole(actionContext.guildId, roleId))) {
      return { success: false, error: 'DiscordRoleDeleteNotPermitted' };
    }

    try {
      const operation = await this.options.store.enqueueRoleDelete({
        guildId: actionContext.guildId,
        discordRoleId: roleId,
        scheduledFor: actionContext.eventTimestamp,
        createdBy: actionContext.actorId,
        source: 'rule-engine',
      });
      return {
        success: true,
        data: { operationId: operation.id, operationStatus: operation.status },
      };
    } catch (error) {
      return { success: false, error: resolveErrorName(error) };
    }
  }
}

export function parseStoredRule(record: StoredRuleRuntimeRecord): RuleDefinition & { id: string } {
  if (record.schemaVersion !== RULE_SCHEMA_VERSION) throw new Error('UnsupportedRuleSchemaVersion');
  if (!record.enabled) throw new Error('DisabledRuleLoadedIntoRuntime');
  if (!record.name.trim() || record.name.length > 200) throw new Error('InvalidStoredRuleName');
  if (!Number.isInteger(record.priority)) throw new Error('InvalidStoredRulePriority');
  if (
    !Number.isInteger(record.cooldownMs) ||
    record.cooldownMs < 0 ||
    record.cooldownMs > MAX_COOLDOWN_MS
  ) {
    throw new Error('InvalidStoredRuleCooldown');
  }
  if (
    record.maxExecutions !== null &&
    (!Number.isInteger(record.maxExecutions) || record.maxExecutions < 1)
  ) {
    throw new Error('InvalidStoredRuleMaxExecutions');
  }
  assertSnowflake(record.createdBy, 'createdBy');

  return {
    id: record.id,
    schemaVersion: record.schemaVersion,
    name: record.name,
    ...(record.description ? { description: record.description } : {}),
    enabled: record.enabled,
    priority: record.priority,
    trigger: parseTrigger(record.trigger),
    conditions: parseConditions(record.conditions),
    actions: parseActions(record.actions),
    cooldownMs: record.cooldownMs,
    ...(record.maxExecutions === null ? {} : { maxExecutions: record.maxExecutions }),
  };
}

/**
 * operationIdはrule + trigger execution + action slotだけから決める。
 * payloadは別fingerprintに束縛するため、同じkeyでpayloadが変わると既存DB repositoryがconflictにする。
 */
export function deriveRoleCreateIdempotency(input: {
  ruleId: string;
  triggerExecutionId: string;
  actionIndex: number;
  actionType: string;
  roleName: string;
  roleColor: number;
  expiresAfterSeconds: number | null;
  scheduledFor: Date;
}): { operationId: string; fingerprint: string } {
  const idSeed = `${input.ruleId}\u0000${input.triggerExecutionId}\u0000${input.actionIndex}`;
  const operationId = uuidFromSha256(idSeed);
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        actionType: input.actionType,
        roleName: input.roleName,
        roleColor: input.roleColor,
        expiresAfterSeconds: input.expiresAfterSeconds,
        scheduledFor: input.scheduledFor.toISOString(),
      }),
    )
    .digest('hex');
  return { operationId, fingerprint };
}

function parseTrigger(value: unknown): RuleDefinition['trigger'] {
  const record = requireRecord(value, 'trigger');
  const type = parseNonEmptyString(record['type'], 'trigger.type', 96);
  const config =
    record['config'] === undefined ? {} : requireRecord(record['config'], 'trigger.config');
  return { type, config };
}

function parseConditions(value: unknown): ConditionNode[] {
  if (!Array.isArray(value) || value.length > MAX_RULE_CONDITIONS) {
    throw new Error('InvalidStoredRuleConditions');
  }
  return value.map((node) => parseConditionNode(node, 0));
}

function parseConditionNode(value: unknown, depth: number): ConditionNode {
  if (depth > MAX_CONDITION_DEPTH) throw new Error('RuleConditionTreeTooDeep');
  const record = requireRecord(value, 'condition');
  const type = parseNonEmptyString(record['type'], 'condition.type', 96);
  const config =
    record['config'] === undefined
      ? undefined
      : requireRecord(record['config'], 'condition.config');
  const rawChildren = record['children'];
  let children: ConditionNode[] | undefined;
  if (rawChildren !== undefined) {
    if (!Array.isArray(rawChildren)) throw new Error('InvalidStoredRuleConditionChildren');
    children = rawChildren.map((child) => parseConditionNode(child, depth + 1));
  }
  return {
    type,
    ...(config ? { config } : {}),
    ...(children ? { children } : {}),
  };
}

function parseActions(value: unknown): RuleDefinition['actions'] {
  if (!Array.isArray(value) || value.length > MAX_RULE_ACTIONS) {
    throw new Error('InvalidStoredRuleActions');
  }
  return value.map((action) => {
    const record = requireRecord(action, 'action');
    const type = parseNonEmptyString(record['type'], 'action.type', 96);
    const config =
      record['config'] === undefined ? {} : requireRecord(record['config'], 'action.config');
    return { type, config };
  });
}

function parseCreateRoleConfig(
  config: Record<string, unknown>,
  temporary: boolean,
): ParsedCreateRoleConfig {
  const roleName = parseNonEmptyString(config['roleName'], 'roleName', 100);
  if (/[\u0000-\u001f\u007f]/u.test(roleName)) throw new Error('InvalidRoleName');
  const roleColor = parseInteger(config['roleColor'] ?? 0, 0, 0xffffff, 'roleColor');
  const expiresAfterSeconds = temporary
    ? parseInteger(config['expiresAfterSeconds'], 60, 31_536_000, 'expiresAfterSeconds')
    : null;
  return { roleName, roleColor, expiresAfterSeconds };
}

function requireBaseContext(value: unknown): RuleBaseContext {
  const record = requireRecord(value, 'ruleRuntimeContext');
  if (typeof record['triggerExecutionId'] !== 'string')
    throw new Error('InvalidRuleRuntimeContext');
  if (!(record['metadata'] instanceof Map)) throw new Error('InvalidRuleRuntimeContext');
  if (
    typeof record['data'] !== 'object' ||
    record['data'] === null ||
    Array.isArray(record['data'])
  ) {
    throw new Error('InvalidRuleRuntimeContext');
  }
  return value as RuleBaseContext;
}

function requireRoleActionContext(value: unknown): RoleActionContext {
  const record = requireRecord(value, 'roleActionContext');
  const guildId = parseSnowflake(record['guildId'], 'guildId');
  const actorId = parseSnowflake(record['actorId'], 'actorId');
  const ruleId = parseNonEmptyString(record['ruleId'], 'ruleId', 64);
  const triggerExecutionId = parseNonEmptyString(
    record['triggerExecutionId'],
    'triggerExecutionId',
    160,
  );
  const actionIndex = parseInteger(record['actionIndex'], 0, MAX_RULE_ACTIONS - 1, 'actionIndex');
  if (
    !(record['eventTimestamp'] instanceof Date) ||
    Number.isNaN(record['eventTimestamp'].getTime())
  ) {
    throw new Error('InvalidRuleEventTimestamp');
  }
  return {
    guildId,
    actorId,
    ruleId,
    triggerExecutionId,
    actionIndex,
    eventTimestamp: record['eventTimestamp'],
  };
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid${field.replace(/[^a-z0-9]/giu, '')}`);
  }
  return value as Record<string, unknown>;
}

function parseSnowflake(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DISCORD_ID_PATTERN.test(value)) {
    throw new Error(`Invalid${field}`);
  }
  return value;
}

function parseNonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`Invalid${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid${field}`);
  return normalized;
}

function parseInteger(value: unknown, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Invalid${field}`);
  }
  return value as number;
}

function assertSnowflake(value: string, field: string): void {
  if (!DISCORD_ID_PATTERN.test(value)) throw new Error(`Invalid${field}`);
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`Invalid${field}`);
}

function uuidFromSha256(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16] ?? '0', 16) % 4] ?? '8';
  const normalized = hex.join('');
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name && error.name !== 'Error') return error.name;
  if (error instanceof Error && error.message) return error.message.slice(0, 120);
  return 'UnknownError';
}
