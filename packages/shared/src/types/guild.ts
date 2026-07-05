/** Guild プラン */
export type GuildPlan = 'free' | 'pro' | 'enterprise';

/** Audit Log のアクター種別 */
export type ActorType = 'user' | 'bot' | 'system';

/** Audit Log の重要度 */
export type AuditSeverity = 'info' | 'warning' | 'critical';

/** Audit Log イベント */
export interface AuditEvent {
  event: string;
  targetType?: string;
  targetId?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  metadata?: Record<string, unknown>;
  severity?: AuditSeverity;
}
