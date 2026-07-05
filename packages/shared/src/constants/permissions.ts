/** Dashboard の権限定義 */
export const Permission = {
  /** Guild 設定の管理 */
  GUILD_MANAGE: 'guild.manage',
  /** ロール管理 */
  ROLE_MANAGE: 'role.manage',
  /** Audit Log 閲覧 */
  AUDIT_VIEW: 'audit.view',
  /** Plugin の管理 */
  PLUGIN_MANAGE: 'plugin.manage',
  /** Plugin 設定の変更 */
  PLUGIN_CONFIG: 'plugin.config',
  /** Rule の管理 */
  RULE_MANAGE: 'rule.manage',
  /** Auto Response の管理 */
  AUTO_RESPONSE_MANAGE: 'auto-response.manage',
  /** Moderation の管理 */
  MODERATION_MANAGE: 'moderation.manage',
  /** Quote の管理 */
  QUOTE_MANAGE: 'quote.manage',
  /** メンバーの閲覧 */
  MEMBER_VIEW: 'member.view',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/** デフォルトロールの権限 */
export const DEFAULT_ROLE_PERMISSIONS: Permission[] = [Permission.MEMBER_VIEW];

/** 管理者ロールの権限 */
export const ADMIN_ROLE_PERMISSIONS: Permission[] = Object.values(Permission);
