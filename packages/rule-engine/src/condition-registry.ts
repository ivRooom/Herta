import type { ConditionDefinition } from '@herta/shared';

/** Condition を登録・評価するレジストリ */
export class ConditionRegistry {
  private conditions = new Map<string, ConditionDefinition>();

  /** Condition を登録する */
  register(condition: ConditionDefinition): void {
    this.conditions.set(condition.type, condition);
  }

  /** 登録済みの Condition を取得する */
  get(type: string): ConditionDefinition | undefined {
    return this.conditions.get(type);
  }

  /** Condition を評価する */
  async evaluate(
    type: string,
    context: unknown,
    config: Record<string, unknown>,
  ): Promise<boolean> {
    const condition = this.conditions.get(type);
    if (!condition) return false;
    return condition.evaluate(context, config);
  }

  /** 全ての登録済み Condition 定義を取得する */
  getAll(): ConditionDefinition[] {
    return [...this.conditions.values()];
  }
}
