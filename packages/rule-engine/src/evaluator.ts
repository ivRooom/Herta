import type {
  TriggerEvent,
  RuleDefinition,
  EvaluationResult,
  ActionResult,
  ConditionNode,
} from '@herta/shared';
import type { TriggerRegistry } from './trigger-registry.js';
import type { ConditionRegistry } from './condition-registry.js';
import type { ActionRegistry } from './action-registry.js';

export interface RuleEvaluatorDeps {
  triggers: TriggerRegistry;
  conditions: ConditionRegistry;
  actions: ActionRegistry;
}

/** Rule 評価エンジン */
export class RuleEvaluator {
  constructor(private deps: RuleEvaluatorDeps) {}

  /** 複数の Rule を priority 降順で評価する */
  async evaluate(
    event: TriggerEvent,
    rules: Array<RuleDefinition & { id: string }>,
    context: unknown,
  ): Promise<EvaluationResult[]> {
    const sorted = [...rules].sort((a, b) => b.priority - a.priority);
    const results: EvaluationResult[] = [];

    for (const rule of sorted) {
      if (!rule.enabled) continue;
      const result = await this.evaluateRule(event, rule, context);
      results.push(result);
    }

    return results;
  }

  private async evaluateRule(
    event: TriggerEvent,
    rule: RuleDefinition & { id: string },
    context: unknown,
  ): Promise<EvaluationResult> {
    const start = Date.now();

    try {
      // Trigger マッチ判定
      const triggerMatched = await this.deps.triggers.evaluate(
        rule.trigger.type,
        event,
        rule.trigger.config,
      );

      if (!triggerMatched) {
        return this.buildResult(rule, start, { triggerMatched: false });
      }

      // Condition 評価 (ツリー)
      const conditionsMet = await this.evaluateConditions(rule.conditions, context);

      if (!conditionsMet) {
        return this.buildResult(rule, start, { triggerMatched: true, conditionsMet: false });
      }

      // Action 実行
      const actionResults: ActionResult[] = [];
      for (const action of rule.actions) {
        const result = await this.deps.actions.execute(action.type, context, action.config);
        actionResults.push(result);
        if (!result.success) break;
      }

      return this.buildResult(rule, start, {
        triggerMatched: true,
        conditionsMet: true,
        actionsExecuted: true,
        actionResults,
      });
    } catch (error) {
      return this.buildResult(rule, start, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async evaluateConditions(
    conditions: ConditionNode[],
    context: unknown,
  ): Promise<boolean> {
    if (conditions.length === 0) return true;

    // 複数 Condition はデフォルトで AND
    for (const condition of conditions) {
      const result = await this.evaluateConditionTree(condition, context);
      if (!result) return false;
    }
    return true;
  }

  private async evaluateConditionTree(
    node: ConditionNode,
    context: unknown,
  ): Promise<boolean> {
    switch (node.type) {
      case 'and':
        for (const child of node.children ?? []) {
          if (!(await this.evaluateConditionTree(child, context))) return false;
        }
        return true;

      case 'or':
        for (const child of node.children ?? []) {
          if (await this.evaluateConditionTree(child, context)) return true;
        }
        return (node.children ?? []).length === 0;

      case 'not':
        if (!node.children?.[0]) return true;
        return !(await this.evaluateConditionTree(node.children[0], context));

      default:
        return this.deps.conditions.evaluate(node.type, context, node.config ?? {});
    }
  }

  private buildResult(
    rule: RuleDefinition & { id: string },
    startMs: number,
    partial: Partial<EvaluationResult>,
  ): EvaluationResult {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      triggerMatched: false,
      conditionsMet: false,
      actionsExecuted: false,
      actionResults: [],
      durationMs: Date.now() - startMs,
      ...partial,
    };
  }
}
