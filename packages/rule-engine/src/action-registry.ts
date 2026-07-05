import type { ActionDefinition, ActionResult } from '@herta/shared';

/** Action を登録・実行するレジストリ */
export class ActionRegistry {
  private actions = new Map<string, ActionDefinition>();

  /** Action を登録する */
  register(action: ActionDefinition): void {
    this.actions.set(action.type, action);
  }

  /** 登録済みの Action を取得する */
  get(type: string): ActionDefinition | undefined {
    return this.actions.get(type);
  }

  /** Action を実行する */
  async execute(
    type: string,
    context: unknown,
    config: Record<string, unknown>,
  ): Promise<ActionResult> {
    const action = this.actions.get(type);
    if (!action) {
      return { success: false, error: `Unknown action type: ${type}` };
    }
    return action.execute(context, config);
  }

  /** 全ての登録済み Action 定義を取得する */
  getAll(): ActionDefinition[] {
    return [...this.actions.values()];
  }
}
