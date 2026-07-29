/** キュー名の定義 */
export const QueueNames = {
  /** スケジュール実行 (cron ジョブ) */
  SCHEDULED: 'scheduled',
  /** Daily Contentの配信 */
  DAILY_CONTENT: 'daily-content',
  /** クリーンアップ (古いログの削除等) */
  CLEANUP: 'cleanup',
  /** 通知送信 */
  NOTIFICATION: 'notification',
  /** Analytics 集計 */
  ANALYTICS: 'analytics',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

/** ジョブデータの型定義 */
export interface JobData {
  [QueueNames.SCHEDULED]: {
    pluginId: string;
    guildId?: string;
    cronExpression: string;
  };
  [QueueNames.DAILY_CONTENT]: {
    deliveryId: string;
    scheduleId: string;
    guildId: string;
    idempotencyKey: string;
    scheduledFor: string;
  };
  [QueueNames.CLEANUP]: {
    targetTable: string;
    retentionDays: number;
  };
  [QueueNames.NOTIFICATION]: {
    guildId: string;
    channelId: string;
    content: string;
  };
  [QueueNames.ANALYTICS]: {
    guildId: string;
    eventType: string;
    data: Record<string, unknown>;
  };
}
