/** システム上限値 */
export const Limits = {
  /** Guild あたりの最大 Rule 数 */
  MAX_RULES_PER_GUILD: 100,
  /** Rule あたりの最大 Condition 数 */
  MAX_CONDITIONS_PER_RULE: 20,
  /** Rule あたりの最大 Action 数 */
  MAX_ACTIONS_PER_RULE: 10,
  /** Condition ツリーの最大深度 */
  MAX_CONDITION_DEPTH: 5,
  /** テンプレート展開後の最大文字数 */
  MAX_TEMPLATE_LENGTH: 2000,
  /** wait Action の最大遅延 (ミリ秒) */
  MAX_WAIT_DURATION_MS: 60_000,
  /** Guild あたりの最大 Auto Response 数 */
  MAX_AUTO_RESPONSES_PER_GUILD: 200,
  /** デフォルトの Rate Limit (リクエスト / 分) */
  DEFAULT_RATE_LIMIT: 100,
  /** デフォルトの Rate Limit 期間 (ミリ秒) */
  DEFAULT_RATE_LIMIT_TTL: 60_000,
  /** Audit Log のデフォルト保持日数 */
  AUDIT_LOG_RETENTION_DAYS: 90,
  /** Rule 実行ログのデフォルト保持日数 */
  RULE_LOG_RETENTION_DAYS: 30,
} as const;
