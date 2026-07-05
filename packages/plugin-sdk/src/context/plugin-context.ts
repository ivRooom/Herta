import type { Logger } from 'pino';
import type {
  CommandDefinition,
  TriggerDefinition,
  ConditionDefinition,
  ActionDefinition,
  AuditEvent,
} from '@herta/shared';

/** Plugin スコープの Redis クライアント */
export interface ScopedRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

/** Plugin に提供されるコンテキスト */
export interface PluginContext {
  /** Plugin スコープのロガー */
  logger: Logger;

  /** Redis クライアント (キーは Plugin ID で自動プレフィックス) */
  cache: ScopedRedisClient;

  /** Slash Command 登録 */
  registerCommands(commands: CommandDefinition[]): void;

  /** Discord イベント購読 */
  on(event: string, handler: (...args: unknown[]) => Promise<void>): void;

  /** Rule Engine Trigger 登録 */
  registerTrigger(trigger: TriggerDefinition): void;

  /** Rule Engine Condition 登録 */
  registerCondition(condition: ConditionDefinition): void;

  /** Rule Engine Action 登録 */
  registerAction(action: ActionDefinition): void;

  /** Audit Log イベント発行 */
  audit(guildId: string, event: AuditEvent): Promise<void>;

  /** 他の Plugin インスタンス取得 (依存宣言が必要) */
  getPlugin<T>(pluginId: string): T | null;

  /** Guild 固有の設定取得 */
  getConfig<T>(guildId: string): Promise<T>;

  /** 定期ジョブのスケジュール */
  schedule(cronExpression: string, handler: () => Promise<void>): void;

  /** Plugin 間イベント発火 */
  emit(eventName: string, payload: unknown): Promise<void>;

  /** Plugin 間イベント購読 */
  subscribe(eventName: string, handler: (payload: unknown) => Promise<void>): void;
}
