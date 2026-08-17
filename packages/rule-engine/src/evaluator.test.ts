import { describe, expect, it, vi } from 'vitest';
import type { ActionDefinition, ConditionDefinition, TriggerDefinition } from '@herta/shared';
import { ActionRegistry } from './action-registry.js';
import { ConditionRegistry } from './condition-registry.js';
import { RuleEvaluator } from './evaluator.js';
import { TriggerRegistry } from './trigger-registry.js';

function createRegistries(execute = vi.fn(async () => ({ success: true }))) {
  const triggers = new TriggerRegistry();
  const conditions = new ConditionRegistry();
  const actions = new ActionRegistry();
  triggers.register({
    type: 'test.trigger',
    name: 'test',
    configSchema: {},
    evaluate: async () => true,
  } satisfies TriggerDefinition);
  conditions.register({
    type: 'test.condition',
    name: 'test',
    configSchema: {},
    evaluate: async () => true,
  } satisfies ConditionDefinition);
  actions.register({
    type: 'test.action',
    name: 'test',
    configSchema: {},
    execute,
  } satisfies ActionDefinition);
  return { triggers, conditions, actions, execute };
}

const event = {
  type: 'test.trigger',
  guildId: '12345678901234567',
  data: {},
  timestamp: new Date('2026-08-17T12:00:00.000Z'),
};

const rule = {
  id: '11111111-1111-4111-8111-111111111111',
  schemaVersion: 1,
  name: 'rule',
  enabled: true,
  priority: 10,
  trigger: { type: 'test.trigger', config: {} },
  conditions: [{ type: 'test.condition', config: {} }],
  actions: [
    { type: 'test.action', config: { index: 0 } },
    { type: 'test.action', config: { index: 1 } },
  ],
};

describe('RuleEvaluator production hooks', () => {
  it('beforeActionsが拒否した場合はActionを実行しない', async () => {
    const registries = createRegistries();
    const evaluator = new RuleEvaluator({
      ...registries,
      beforeActions: async () => ({ allowed: false, reason: 'cooldown' }),
    });

    const [result] = await evaluator.evaluate(event, [rule], { source: 'test' });

    expect(result).toMatchObject({
      triggerMatched: true,
      conditionsMet: true,
      actionsExecuted: false,
      actionSkipReason: 'cooldown',
    });
    expect(registries.execute).not.toHaveBeenCalled();
  });

  it('Action context factoryへruleとaction indexを渡す', async () => {
    const contexts: unknown[] = [];
    const execute = vi.fn(async (context: unknown) => {
      contexts.push(context);
      return { success: true };
    });
    const registries = createRegistries(execute);
    const evaluator = new RuleEvaluator({
      ...registries,
      beforeActions: async () => ({ allowed: true }),
      createActionContext: ({ rule: currentRule, actionIndex }) => ({
        ruleId: currentRule.id,
        actionIndex,
      }),
    });

    const [result] = await evaluator.evaluate(event, [rule], { source: 'test' });

    expect(result?.actionsExecuted).toBe(true);
    expect(contexts).toEqual([
      { ruleId: rule.id, actionIndex: 0 },
      { ruleId: rule.id, actionIndex: 1 },
    ]);
  });
});
