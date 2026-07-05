/** Trigger イベント */
export interface TriggerEvent {
  type: string;
  guildId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

/** Trigger 定義 */
export interface TriggerDefinition {
  type: string;
  name: string;
  description?: string;
  configSchema: Record<string, unknown>;
  evaluate(event: TriggerEvent, config: Record<string, unknown>): Promise<boolean>;
}

/** Condition ノード (ツリー構造) */
export interface ConditionNode {
  type: 'and' | 'or' | 'not' | string;
  config?: Record<string, unknown>;
  children?: ConditionNode[];
}

/** Condition 定義 */
export interface ConditionDefinition {
  type: string;
  name: string;
  description?: string;
  configSchema: Record<string, unknown>;
  evaluate(context: unknown, config: Record<string, unknown>): Promise<boolean>;
}

/** Action 実行結果 */
export interface ActionResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

/** Action 定義 */
export interface ActionDefinition {
  type: string;
  name: string;
  description?: string;
  configSchema: Record<string, unknown>;
  execute(context: unknown, config: Record<string, unknown>): Promise<ActionResult>;
}

/** Rule 定義 (JSON) */
export interface RuleDefinition {
  schemaVersion: number;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  trigger: {
    type: string;
    config: Record<string, unknown>;
  };
  conditions: ConditionNode[];
  actions: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
  cooldownMs?: number;
  maxExecutions?: number;
}

/** Rule 評価結果 */
export interface EvaluationResult {
  ruleId: string;
  ruleName: string;
  triggerMatched: boolean;
  conditionsMet: boolean;
  actionsExecuted: boolean;
  actionResults: ActionResult[];
  error?: string;
  durationMs: number;
}
