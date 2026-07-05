import type { TriggerEvent, TriggerDefinition } from '@herta/shared';

/** Trigger を登録・評価するレジストリ */
export class TriggerRegistry {
  private triggers = new Map<string, TriggerDefinition>();

  /** Trigger を登録する */
  register(trigger: TriggerDefinition): void {
    this.triggers.set(trigger.type, trigger);
  }

  /** 登録済みの Trigger を取得する */
  get(type: string): TriggerDefinition | undefined {
    return this.triggers.get(type);
  }

  /** Trigger を評価する */
  async evaluate(
    type: string,
    event: TriggerEvent,
    config: Record<string, unknown>,
  ): Promise<boolean> {
    const trigger = this.triggers.get(type);
    if (!trigger) return false;
    return trigger.evaluate(event, config);
  }

  /** 全ての登録済み Trigger 定義を取得する */
  getAll(): TriggerDefinition[] {
    return [...this.triggers.values()];
  }
}
