import type { Prisma, PrismaClient } from '@herta/db';
import { searchCommandExecutionEvents, searchMemberActivityEvents } from '@herta/db';
import {
  DEFAULT_PLUGIN_RUNTIME_CONSUMER,
  isPluginRuntimeConsumer,
  type PluginRuntimeConsumer,
} from '@herta/shared';

export type AuditLogCategory =
  | 'all'
  | 'plugin'
  | 'quote'
  | 'auto_response'
  | 'moderation'
  | 'rule'
  | 'access_group'
  | 'access_policy'
  | 'role'
  | 'bot_profile'
  | 'birthday'
  | 'achievement'
  | 'xp'
  | 'anniversary'
  | 'suggestion'
  | 'message_studio'
  | 'mcp'
  | 'login'
  | 'other';
export type AuditLogSeverity = 'all' | 'info' | 'warning' | 'error' | 'critical';

/**
 * admin_action: 既存のAuditLog(Plugin設定変更・モデレーション等、管理者が明示的に行った操作)。
 * discord_activity: MemberActivityEvent(メッセージ編集/削除・チャンネル作成/削除等、Discordの
 * gatewayイベントを検知して記録したもの)。
 * command_usage: CommandExecutionEvent(全スラッシュコマンドの実行、性能テレメトリ)。
 * all: 3つを読み取り時にマージして表示する(最新pageSize件のみ、ページ送りは未対応)。
 */
export type AuditActivitySource = 'all' | 'admin_action' | 'discord_activity' | 'command_usage';

export interface AuditLogQuery {
  page: number;
  pageSize: number;
  search: string;
  category: AuditLogCategory;
  severity: AuditLogSeverity;
  source: AuditActivitySource;
  from: Date | null;
  toExclusive: Date | null;
  fromInput: string;
  toInput: string;
}

export interface AuditLogItem {
  id: string;
  event: string;
  eventLabel: string;
  summary: string;
  category: Exclude<AuditLogCategory, 'all'>;
  severity: string;
  activitySource: Exclude<AuditActivitySource, 'all'>;
  actorId: string;
  actorType: string;
  actorLabel: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string;
  sourceLabel: string | null;
  createdAt: string;
}

export interface AuditLogResult {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** source='all'の場合、最新pageSize件のみを返しページ送りに対応しない旨を示す。 */
  isUnifiedPreview: boolean;
}

export interface AuditEventPresentation {
  eventLabel: string;
  summary: string;
  category: Exclude<AuditLogCategory, 'all'>;
  targetLabel: string;
  sourceLabel: string | null;
}

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

type RuntimeConsumerResolution = PluginRuntimeConsumer | 'unknown' | null;

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 100;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_CATEGORIES = new Set<AuditLogCategory>([
  'all',
  'plugin',
  'quote',
  'auto_response',
  'moderation',
  'rule',
  'access_group',
  'access_policy',
  'role',
  'bot_profile',
  'birthday',
  'achievement',
  'xp',
  'anniversary',
  'suggestion',
  'message_studio',
  'mcp',
  'login',
  'other',
]);

/**
 * イベント名の接頭辞からカテゴリを解決するための対応表。resolveCategory/buildAuditLogWhereの
 * 両方がこの単一の定義を参照することで、「カテゴリを追加したのにfilterへ反映し忘れる」を防ぐ。
 */
const CATEGORY_PREFIXES: ReadonlyArray<{
  category: Exclude<AuditLogCategory, 'all' | 'other'>;
  prefixes: readonly string[];
}> = [
  { category: 'plugin', prefixes: ['plugin.'] },
  { category: 'quote', prefixes: ['quote.'] },
  { category: 'auto_response', prefixes: ['auto_response.'] },
  { category: 'moderation', prefixes: ['moderation.'] },
  { category: 'rule', prefixes: ['rule.'] },
  { category: 'access_group', prefixes: ['studio_access_group.'] },
  { category: 'access_policy', prefixes: ['studio_access_policy.'] },
  { category: 'role', prefixes: ['discord_role.'] },
  { category: 'bot_profile', prefixes: ['bot_profile.'] },
  { category: 'birthday', prefixes: ['birthday.', 'birthday_card.'] },
  { category: 'achievement', prefixes: ['achievement.'] },
  { category: 'xp', prefixes: ['leaderboard.xp_'] },
  { category: 'anniversary', prefixes: ['guild.anniversary_'] },
  { category: 'suggestion', prefixes: ['suggestion.'] },
  { category: 'message_studio', prefixes: ['message_studio.'] },
  { category: 'mcp', prefixes: ['mcp.'] },
  { category: 'login', prefixes: ['studio_auth.'] },
];
const ALLOWED_SEVERITIES = new Set<AuditLogSeverity>([
  'all',
  'info',
  'warning',
  'error',
  'critical',
]);
const ALLOWED_ACTIVITY_SOURCES = new Set<AuditActivitySource>([
  'all',
  'admin_action',
  'discord_activity',
  'command_usage',
]);
/** source='all'でマージ表示する際の最大件数(ページ送り未対応のため、最新分のみを示す)。 */
const UNIFIED_PREVIEW_LIMIT = 25;

const AUTOMATIC_ACTION_LABELS: Record<string, string> = {
  observe: '監視のみ',
  warn: '警告',
  delete: 'メッセージ削除',
  warn_delete: '警告 + メッセージ削除',
  timeout: 'タイムアウト',
  role: 'ロール付与',
  blacklist: 'ブラックリスト登録 + BAN',
  kick: 'Kick',
  ban: 'BAN',
};
const AUTOMATIC_SEVERITY_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '重大',
};

const EVENT_LABELS: Record<string, { label: string; summary: string }> = {
  'plugin.enable': {
    label: 'Pluginを有効化',
    summary: 'Pluginの有効状態をオンにしました。',
  },
  'plugin.disable': {
    label: 'Pluginを無効化',
    summary: 'Pluginの有効状態をオフにしました。',
  },
  'plugin.config_update': {
    label: 'Plugin設定を更新',
    summary: 'Pluginの設定を更新しました。設定値は監査画面には表示しません。',
  },
  'plugin.runtime_publish_succeeded': {
    label: 'Runtime通知を送信',
    summary: 'Plugin Runtime更新イベントを送信しました。',
  },
  'plugin.runtime_publish_failed': {
    label: 'Runtime通知の送信に失敗',
    summary: 'Plugin Runtime更新イベントを送信できませんでした。',
  },
  'plugin.runtime_apply_succeeded': {
    label: 'Runtime設定を反映',
    summary: 'Runtime consumerがPlugin Runtime設定を再同期しました。',
  },
  'plugin.runtime_apply_failed': {
    label: 'Runtime設定の反映に失敗',
    summary: 'Runtime consumerがPlugin Runtime設定を再同期できませんでした。',
  },
  'quote.create': {
    label: 'Quoteを登録',
    summary: 'Quoteを新しく登録しました。本文は監査画面には表示しません。',
  },
  'quote.update': {
    label: 'Quoteを更新',
    summary: 'Quoteの本文・作者・タグ・公開設定のいずれかを更新しました。',
  },
  'quote.delete': {
    label: 'Quoteを削除',
    summary: 'Quoteを削除しました。削除前の本文は監査画面には表示しません。',
  },
  'auto_response.create': {
    label: '自動応答ルールを作成',
    summary: 'Auto Responseルールを作成しました。トリガーと応答本文は表示しません。',
  },
  'auto_response.update': {
    label: '自動応答ルールを更新',
    summary: 'Auto Responseルールの設定を更新しました。本文は表示しません。',
  },
  'auto_response.enable': {
    label: '自動応答ルールを有効化',
    summary: 'Auto Responseルールを有効化しました。',
  },
  'auto_response.disable': {
    label: '自動応答ルールを無効化',
    summary: 'Auto Responseルールを無効化しました。',
  },
  'auto_response.delete': {
    label: '自動応答ルールを削除',
    summary: 'Auto Responseルールを削除しました。削除前の本文は表示しません。',
  },
  'moderation.automatic.decision': {
    label: '自動Moderation判定',
    summary: '自動対応ポリシーの判定結果が記録されました。',
  },
  'moderation.automatic.executed': {
    label: '自動Moderation実行',
    summary: '自動Moderationの対応が実行されました。',
  },
  'moderation.automatic.failed': {
    label: '自動Moderation失敗',
    summary: '自動Moderationの対応に失敗しました。',
  },
  'rule.created': {
    label: '自動ルールを作成',
    summary: 'Auto Ruleを新しく作成しました。',
  },
  'rule.updated': {
    label: '自動ルールを更新',
    summary: 'Auto Ruleの設定を更新しました。',
  },
  'rule.deleted': {
    label: '自動ルールを削除',
    summary: 'Auto Ruleを削除しました。',
  },
  'rule.member_role_added': {
    label: '自動ルールでRoleを付与',
    summary: 'Auto Ruleの条件達成によりMemberへRoleを付与しました。',
  },
  'studio_access_group.created': {
    label: 'アクセスグループを作成',
    summary: 'Studio Access Groupを新しく作成しました。',
  },
  'studio_access_group.updated': {
    label: 'アクセスグループを更新',
    summary: 'Studio Access Groupの設定を更新しました。',
  },
  'studio_access_group.deleted': {
    label: 'アクセスグループを削除',
    summary: 'Studio Access Groupを削除しました。',
  },
  'studio_access_group.member_added': {
    label: 'アクセスグループにMemberを追加',
    summary: 'Studio Access GroupへMemberを追加しました。',
  },
  'studio_access_group.member_removed': {
    label: 'アクセスグループからMemberを削除',
    summary: 'Studio Access GroupからMemberを削除しました。',
  },
  'studio_access_policy.created': {
    label: 'アクセスポリシーを作成',
    summary: 'Studio Access Policyを新しく作成しました。',
  },
  'studio_access_policy.updated': {
    label: 'アクセスポリシーを更新',
    summary: 'Studio Access Policyの設定を更新しました。',
  },
  'studio_access_policy.deleted': {
    label: 'アクセスポリシーを削除',
    summary: 'Studio Access Policyを削除しました。',
  },
  'studio_access_policy.attached': {
    label: 'アクセスポリシーを割り当て',
    summary: 'Access GroupへAccess Policyを割り当てました。',
  },
  'studio_access_policy.detached': {
    label: 'アクセスポリシーの割り当てを解除',
    summary: 'Access GroupからAccess Policyの割り当てを解除しました。',
  },
  'discord_role.create_requested': {
    label: 'Discord Roleの作成を要求',
    summary: 'StudioからDiscord Roleの新規作成をBotへ要求しました。',
  },
  'discord_role.delete_requested': {
    label: 'Discord Roleの削除を要求',
    summary: 'StudioからDiscord Roleの削除をBotへ要求しました。',
  },
  'bot_profile.updated': {
    label: 'Botプロフィールを更新',
    summary: 'Herta Botの表示名・アイコンなどのプロフィールを更新しました。',
  },
  'birthday.registration_set': {
    label: '誕生日を登録',
    summary: 'Memberの誕生日情報を登録・更新しました。',
  },
  'birthday.registration_remove': {
    label: '誕生日登録を削除',
    summary: 'Memberの誕生日情報を削除しました。',
  },
  'birthday_card.asset.renamed': {
    label: 'Birthday Card画像の名前を変更',
    summary: 'Birthday Cardで使う画像素材の名前を変更しました。',
  },
  'birthday_card.asset.deleted': {
    label: 'Birthday Card画像を削除',
    summary: 'Birthday Cardで使う画像素材を削除しました。',
  },
  'birthday_card.asset.preset_added': {
    label: 'Birthday Card画像をPresetに追加',
    summary: '画像素材をPreset(共通素材)として登録しました。',
  },
  'birthday_card.asset.preset_removed': {
    label: 'Birthday Card画像をPresetから削除',
    summary: '画像素材のPreset(共通素材)登録を解除しました。',
  },
  'birthday_card.background.updated': {
    label: 'Birthday Card背景を更新',
    summary: 'Birthday Cardの背景画像を更新しました。',
  },
  'birthday_card.background.deleted': {
    label: 'Birthday Card背景を削除',
    summary: 'Birthday Cardの背景画像を削除しました。',
  },
  'birthday_card.test_send': {
    label: 'Birthday Cardのテスト送信',
    summary: 'Birthday Cardのテスト送信を実行しました。',
  },
  'birthday_card.test_send_attempt': {
    label: 'Birthday Cardのテスト送信を試行',
    summary: 'Birthday Cardのテスト送信を試行しました（結果は別イベントで記録されます）。',
  },
  'achievement.manual_grant': {
    label: '実績を手動付与',
    summary: 'Memberへ実績(Achievement)を手動で付与しました。',
  },
  'achievement.manual_revoke': {
    label: '実績の手動付与を取消',
    summary: 'Memberの実績(Achievement)付与を手動で取り消しました。',
  },
  'leaderboard.xp_reset_guild': {
    label: 'XPをリセット',
    summary: 'Guild全体またはMember個人のXPをリセットしました。',
  },
  'leaderboard.xp_role_sweep_requested': {
    label: 'XP Role再計算を要求',
    summary: 'XPに応じたRole付与の再計算をBotへ要求しました。',
  },
  'leaderboard.xp_role_sweep_failed': {
    label: 'XP Role再計算が失敗',
    summary: 'XPに応じたRole付与の再計算に失敗しました。',
  },
  'leaderboard.xp_role_sweep_completed': {
    label: 'XP Role再計算が完了',
    summary: 'XPに応じたRole付与の再計算が完了しました。',
  },
  'guild.anniversary_set': {
    label: '周年記念日を登録',
    summary: 'Guildの周年記念日を登録・更新しました。',
  },
  'guild.anniversary_remove': {
    label: '周年記念日を削除',
    summary: 'Guildの周年記念日の登録を削除しました。',
  },
  'suggestion.edit': {
    label: '提案を編集',
    summary: 'Member提案(Suggestion)の内容を編集しました。',
  },
  'suggestion.withdraw': {
    label: '提案を取り下げ',
    summary: 'Member提案(Suggestion)を取り下げました。',
  },
  'suggestion.status': {
    label: '提案のステータスを変更',
    summary: 'Member提案(Suggestion)の対応状況を変更しました。',
  },
  'message_studio.send': {
    label: 'Message Studioから送信',
    summary: 'Message StudioからGuildへメッセージを送信しました。',
  },
  'mcp.tool_called': {
    label: 'MCPツールを呼び出し',
    summary: 'MCPツールの呼び出しを記録しました。',
  },
};

export function parseAuditLogQuery(searchParams: URLSearchParams): AuditLogQuery {
  const categoryValue = searchParams.get('category') ?? 'all';
  const severityValue = searchParams.get('severity') ?? 'all';
  const sourceValue = searchParams.get('source') ?? 'admin_action';
  const fromInput = normalizeDateInput(searchParams.get('from'));
  const toInput = normalizeDateInput(searchParams.get('to'));

  return {
    page: parsePositiveInteger(searchParams.get('page'), 1),
    pageSize: Math.min(
      parsePositiveInteger(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    ),
    search: (searchParams.get('search') ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    category: ALLOWED_CATEGORIES.has(categoryValue as AuditLogCategory)
      ? (categoryValue as AuditLogCategory)
      : 'all',
    severity: ALLOWED_SEVERITIES.has(severityValue as AuditLogSeverity)
      ? (severityValue as AuditLogSeverity)
      : 'all',
    source: ALLOWED_ACTIVITY_SOURCES.has(sourceValue as AuditActivitySource)
      ? (sourceValue as AuditActivitySource)
      : 'admin_action',
    from: parseJstDate(fromInput, false),
    toExclusive: parseJstDate(toInput, true),
    fromInput,
    toInput,
  };
}

export function resolveAuditLogPage(requestedPage: number, totalPages: number): number {
  const normalizedTotalPages = Math.max(1, Math.floor(totalPages));
  const normalizedRequestedPage = Number.isSafeInteger(requestedPage)
    ? Math.max(1, requestedPage)
    : 1;
  return Math.min(normalizedRequestedPage, normalizedTotalPages);
}

export async function listGuildAuditLogs(
  prisma: PrismaClient,
  guildId: string,
  query: AuditLogQuery,
): Promise<AuditLogResult> {
  const where = buildAuditLogWhere(guildId, query);
  const total = await prisma.auditLog.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = resolveAuditLogPage(query.page, totalPages);
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      actorId: true,
      actorType: true,
      event: true,
      targetType: true,
      targetId: true,
      metadata: true,
      severity: true,
      createdAt: true,
    },
  });

  const actorIds = [
    ...new Set(rows.filter((row) => row.actorType === 'user').map((row) => row.actorId)),
  ];
  const users =
    actorIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, username: true, discriminator: true },
        });
  const usersById = new Map(users.map((user) => [user.id, user]));

  return {
    items: rows.map((row) => {
      const presentation = describeAuditEvent(
        row.event,
        row.targetType,
        row.targetId,
        row.metadata,
      );
      const user = usersById.get(row.actorId);

      return {
        id: row.id,
        event: row.event,
        eventLabel: presentation.eventLabel,
        summary: presentation.summary,
        category: presentation.category,
        severity: row.severity,
        activitySource: 'admin_action' as const,
        actorId: row.actorId,
        actorType: row.actorType,
        actorLabel: resolveActorLabel(row.actorType, user),
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel: presentation.targetLabel,
        sourceLabel: presentation.sourceLabel,
        createdAt: row.createdAt.toISOString(),
      };
    }),
    total,
    page,
    pageSize: query.pageSize,
    totalPages,
    isUnifiedPreview: false,
  };
}

/** apps/bot/src/plugins/activity-log.tsのMEMBER_ACTIVITY_EVENT_LABELSと同じ文言。 */
const DISCORD_ACTIVITY_EVENT_LABELS: Record<string, string> = {
  voice_join: 'VC入室',
  voice_leave: 'VC退室',
  message_create: 'メッセージ作成',
  message_update: 'メッセージ編集',
  message_delete: 'メッセージ削除',
  emoji_create: '絵文字登録',
  emoji_update: '絵文字変更',
  emoji_delete: '絵文字削除',
  avatar_update: 'アバター変更',
  nickname_update: 'ニックネーム変更',
  role_add: 'ロール付与',
  role_remove: 'ロール剥奪',
  guild_icon_update: 'サーバーアイコン変更',
  guild_banner_update: 'サーバーバナー変更',
  channel_create: 'チャンネル作成',
  channel_delete: 'チャンネル削除',
};

function discordActivityEventLabel(event: string): string {
  return DISCORD_ACTIVITY_EVENT_LABELS[event] ?? event;
}

function discordActivitySummary(event: string, metadata: Record<string, unknown> | null): string {
  if ((event === 'channel_create' || event === 'channel_delete') && metadata) {
    const channelName = typeof metadata.channelName === 'string' ? metadata.channelName : null;
    if (channelName) {
      return event === 'channel_create' ? `#${channelName} を作成` : `#${channelName} を削除`;
    }
  }
  return `${discordActivityEventLabel(event)}が記録されました。`;
}

/**
 * Studioの監査ログ画面で、既存のAuditLog(管理操作)に加えてMemberActivityEvent
 * (Discordのgatewayイベント)・CommandExecutionEvent(コマンド実行)も同じ画面で
 * 閲覧できるようにする。書き込みは3つのテーブルへ分かれたまま(保持期間・書き込み
 * 頻度が大きく異なるため統合しない)、表示だけ読み取り時にマージする。
 *
 * source='all'の場合は各ソースの最新pageSize件だけをマージし、ページ送りには対応
 * しない(3ソースの合計件数に対して正確なページングを行うと、ソースごとに保持期間・
 * 書き込み頻度が大きく異なるため複雑になりすぎるための設計判断)。
 */
export async function listGuildActivityFeed(
  prisma: PrismaClient,
  guildId: string,
  query: AuditLogQuery,
): Promise<AuditLogResult> {
  if (query.source === 'admin_action') {
    return listGuildAuditLogs(prisma, guildId, query);
  }
  if (query.source === 'discord_activity') {
    return listDiscordActivityFeed(prisma, guildId, query);
  }
  if (query.source === 'command_usage') {
    return listCommandUsageFeed(prisma, guildId, query);
  }

  const [adminResult, discordResult, commandResult] = await Promise.all([
    listGuildAuditLogs(prisma, guildId, { ...query, page: 1, pageSize: UNIFIED_PREVIEW_LIMIT }),
    listDiscordActivityFeed(prisma, guildId, {
      ...query,
      page: 1,
      pageSize: UNIFIED_PREVIEW_LIMIT,
    }),
    listCommandUsageFeed(prisma, guildId, { ...query, page: 1, pageSize: UNIFIED_PREVIEW_LIMIT }),
  ]);

  const merged = [...adminResult.items, ...discordResult.items, ...commandResult.items]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, UNIFIED_PREVIEW_LIMIT);

  return {
    items: merged,
    total: adminResult.total + discordResult.total + commandResult.total,
    page: 1,
    pageSize: UNIFIED_PREVIEW_LIMIT,
    totalPages: 1,
    isUnifiedPreview: true,
  };
}

async function listDiscordActivityFeed(
  prisma: PrismaClient,
  guildId: string,
  query: AuditLogQuery,
): Promise<AuditLogResult> {
  const { items: rows, total } = await searchMemberActivityEvents(prisma, {
    guildId,
    from: query.from,
    toExclusive: query.toExclusive,
    page: query.page,
    pageSize: query.pageSize,
  });

  const userIds = [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
  const actorLabelById = await resolveUserLabels(prisma, userIds);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  return {
    items: rows.map((row) => ({
      id: row.id,
      event: row.event,
      eventLabel: discordActivityEventLabel(row.event),
      summary: discordActivitySummary(row.event, row.metadata),
      category: 'other',
      severity: 'info',
      activitySource: 'discord_activity',
      actorId: row.userId ?? '',
      actorType: 'user',
      actorLabel: row.userId ? (actorLabelById.get(row.userId) ?? 'Discordユーザー') : '不明',
      targetType: row.channelId ? 'channel' : null,
      targetId: row.channelId,
      targetLabel: row.channelId ? `#${row.channelId}` : '対象情報なし',
      sourceLabel: null,
      createdAt: row.occurredAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages,
    isUnifiedPreview: false,
  };
}

async function listCommandUsageFeed(
  prisma: PrismaClient,
  guildId: string,
  query: AuditLogQuery,
): Promise<AuditLogResult> {
  const result = await searchCommandExecutionEvents(prisma, {
    guildId,
    rangeDays: resolveCommandUsageRangeDays(query),
    page: query.page,
    pageSize: query.pageSize,
  });

  const userIds = [...new Set(result.items.flatMap((row) => (row.userId ? [row.userId] : [])))];
  const actorLabelById = await resolveUserLabels(prisma, userIds);
  const statusLabel = (status: string): string => (status === 'success' ? '成功' : '失敗');

  return {
    items: result.items.map((row) => ({
      id: row.id,
      event: row.commandName,
      eventLabel: `/${row.commandName}`,
      summary: `/${row.commandName} を実行(${statusLabel(row.status)}${row.errorName ? ` — ${row.errorName}` : ''})`,
      category: 'other',
      severity: row.status === 'success' ? 'info' : 'warning',
      activitySource: 'command_usage',
      actorId: row.userId ?? '',
      actorType: 'user',
      actorLabel: row.userId ? (actorLabelById.get(row.userId) ?? 'Discordユーザー') : '不明',
      targetType: null,
      targetId: null,
      targetLabel: '対象情報なし',
      sourceLabel: null,
      createdAt: row.executedAt,
    })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    isUnifiedPreview: false,
  };
}

/**
 * CommandExecutionEventのrangeDays(日数ベース)と、AuditLog等が使うfrom/toExclusiveの
 * 日付範囲フィルタの橋渡し。fromが指定されていれば現在日時との差分日数へ変換する。
 */
function resolveCommandUsageRangeDays(query: AuditLogQuery): number | undefined {
  if (!query.from) return undefined;
  const diffMs = Date.now() - query.from.getTime();
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

async function resolveUserLabels(
  prisma: PrismaClient,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, username: true, discriminator: true },
  });
  return new Map(
    users.map((user) => [
      user.id,
      user.discriminator && user.discriminator !== '0'
        ? `${user.username}#${user.discriminator}`
        : user.username,
    ]),
  );
}

export function describeAuditEvent(
  event: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Prisma.JsonValue | null,
): AuditEventPresentation {
  const eventMeta = EVENT_LABELS[event];
  const category = resolveCategory(event);
  const metadataRecord = asRecord(metadata);
  const quoteNumber = positiveInteger(metadataRecord?.['quoteNumber']);
  const operationSource = stringValue(metadataRecord?.['operationSource']);
  const runtimeConsumer = resolveRuntimeConsumer(event, metadataRecord);

  return {
    eventLabel: resolveAuditEventLabel(event, runtimeConsumer, eventMeta?.label),
    summary: resolveAuditSummary(event, metadataRecord, runtimeConsumer, eventMeta?.summary),
    category,
    targetLabel: resolveTargetLabel(targetType, targetId, quoteNumber),
    sourceLabel: resolveSourceLabel(event, operationSource, runtimeConsumer),
  };
}

function resolveAuditEventLabel(
  event: string,
  runtimeConsumer: RuntimeConsumerResolution,
  fallback: string | undefined,
): string {
  if (event === 'plugin.runtime_apply_succeeded') {
    return `Runtime設定を${runtimeConsumerDisplayLabel(runtimeConsumer)}へ反映`;
  }
  if (event === 'plugin.runtime_apply_failed') {
    return `Runtime設定の${runtimeConsumerDisplayLabel(runtimeConsumer)}反映に失敗`;
  }
  if (event === 'studio_auth.sign_in') {
    return 'Studioログイン';
  }
  return fallback ?? event;
}

function resolveAuditSummary(
  event: string,
  metadata: Record<string, Prisma.JsonValue> | null,
  runtimeConsumer: RuntimeConsumerResolution,
  fallback: string | undefined,
): string {
  if (event === 'plugin.runtime_apply_succeeded' && booleanValue(metadata?.['recovery']) === true) {
    return `${runtimeConsumerDisplayLabel(runtimeConsumer)}起動時の再同期でPlugin Runtime設定の復旧を確認しました。`;
  }
  if (event === 'plugin.runtime_apply_succeeded') {
    return `${runtimeConsumerDisplayLabel(runtimeConsumer)}がPlugin Runtime設定を再同期しました。`;
  }
  if (event === 'plugin.runtime_apply_failed') {
    return `${runtimeConsumerDisplayLabel(runtimeConsumer)}がPlugin Runtime設定を再同期できませんでした。`;
  }
  if (event === 'moderation.automatic.decision') {
    return (
      resolveAutomaticDecisionSummary(metadata) ?? fallback ?? '自動Moderation判定を記録しました。'
    );
  }
  if (event === 'moderation.automatic.executed' || event === 'moderation.automatic.failed') {
    return (
      resolveAutomaticExecutionSummary(metadata) ?? fallback ?? '自動Moderation結果を記録しました。'
    );
  }
  if (event === 'mcp.tool_called') {
    return resolveMcpToolCallSummary(metadata) ?? fallback ?? 'MCPツールの呼び出しを記録しました。';
  }
  if (event === 'studio_auth.sign_in') {
    return booleanValue(metadata?.['isNewUser']) === true
      ? '初めてStudioへログインしました。'
      : 'Studioへログインしました。';
  }
  return fallback ?? '管理対象に対する操作が記録されました。';
}

function resolveMcpToolCallSummary(
  metadata: Record<string, Prisma.JsonValue> | null,
): string | null {
  const outcome = stringValue(metadata?.['outcome']);
  if (outcome === 'succeeded') return 'MCPツールを呼び出し、結果をAIへ返しました。';
  if (outcome === 'failed') return 'MCPツールの呼び出しに失敗しました。';
  if (outcome === 'rate_limited')
    return 'MCPツールの利用上限に達したため、呼び出しをスキップしました。';
  return null;
}

function resolveAutomaticDecisionSummary(
  metadata: Record<string, Prisma.JsonValue> | null,
): string | null {
  if (!metadata) return null;
  const outcome = stringValue(metadata['outcome']);
  const action = stringValue(metadata['action']);
  const severity = stringValue(metadata['severity']);
  const outcomeLabel = outcome ? decisionOutcomeLabel(outcome) : null;
  const actionLabel = action ? automaticActionLabel(action) : null;
  const severityLabel = severity ? automaticSeverityLabel(severity) : null;
  const parts = [
    outcomeLabel ? `判定: ${outcomeLabel}` : null,
    actionLabel ? `対応: ${actionLabel}` : null,
    severityLabel ? `危険度: ${severityLabel}` : null,
  ];

  if (action === 'delete' || action === 'warn_delete') {
    const deletable = booleanValue(metadata['messageDeletable']);
    const canManageMessages = booleanValue(metadata['botCanManageMessages']);
    parts.push(
      deletable === null ? null : `メッセージ削除可能: ${deletable ? 'はい' : 'いいえ'}`,
      canManageMessages === null
        ? null
        : `Botのメッセージ管理権限: ${canManageMessages ? 'あり' : 'なし'}`,
    );
  }

  const visible = parts.filter((part): part is string => part !== null);
  return visible.length > 0 ? visible.join(' / ') : null;
}

function resolveAutomaticExecutionSummary(
  metadata: Record<string, Prisma.JsonValue> | null,
): string | null {
  if (!metadata) return null;
  const actionOutcome = stringValue(metadata['actionOutcome']);
  const action = stringValue(metadata['action']);
  const actionOutcomeLabel = actionOutcome ? automaticActionOutcomeLabel(actionOutcome) : null;
  const actionLabel = action ? automaticActionLabel(action) : null;
  const errorCode = discordErrorCodeValue(metadata['discordErrorCode']);
  const httpStatus = httpStatusValue(metadata['discordHttpStatus']);
  const parts = [
    actionOutcomeLabel ? `実行結果: ${actionOutcomeLabel}` : null,
    actionLabel ? `対応: ${actionLabel}` : null,
    errorCode === null ? null : `Discord code: ${errorCode}`,
    httpStatus === null ? null : `HTTP: ${httpStatus}`,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' / ') : null;
}

function decisionOutcomeLabel(value: string): string | null {
  if (value === 'disabled') return '自動対応OFF（実行なし）';
  if (value === 'observe') return '監視のみ';
  if (value === 'execute') return '実行対象';
  return null;
}

function automaticActionOutcomeLabel(value: string): string | null {
  if (value === 'executed') return '成功';
  if (value === 'already_satisfied') return '既に目的達成';
  if (value === 'failed') return '失敗';
  return null;
}

function automaticActionLabel(value: string): string | null {
  return AUTOMATIC_ACTION_LABELS[value] ?? null;
}

function automaticSeverityLabel(value: string): string | null {
  return AUTOMATIC_SEVERITY_LABELS[value] ?? null;
}

function buildAuditLogWhere(guildId: string, query: AuditLogQuery): Prisma.AuditLogWhereInput {
  const filters: Prisma.AuditLogWhereInput[] = [{ guildId }];

  if (query.category === 'other') {
    filters.push({
      NOT: CATEGORY_PREFIXES.flatMap((entry) =>
        entry.prefixes.map((prefix) => ({ event: { startsWith: prefix } })),
      ),
    });
  } else if (query.category !== 'all') {
    const entry = CATEGORY_PREFIXES.find((candidate) => candidate.category === query.category);
    if (entry) {
      filters.push({
        OR: entry.prefixes.map((prefix) => ({ event: { startsWith: prefix } })),
      });
    }
  }
  if (query.severity !== 'all') filters.push({ severity: query.severity });
  if (query.from || query.toExclusive) {
    filters.push({
      createdAt: {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.toExclusive ? { lt: query.toExclusive } : {}),
      },
    });
  }
  if (query.search) {
    filters.push({
      OR: [
        { event: { contains: query.search, mode: 'insensitive' } },
        { actorId: { contains: query.search, mode: 'insensitive' } },
        { targetId: { contains: query.search, mode: 'insensitive' } },
        { targetType: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  return { AND: filters };
}

function resolveCategory(event: string): Exclude<AuditLogCategory, 'all'> {
  for (const entry of CATEGORY_PREFIXES) {
    if (entry.prefixes.some((prefix) => event.startsWith(prefix))) return entry.category;
  }
  return 'other';
}

function resolveSourceLabel(
  event: string,
  operationSource: string | null,
  runtimeConsumer: RuntimeConsumerResolution,
): string | null {
  if (
    event === 'plugin.runtime_apply_succeeded' &&
    runtimeConsumer === 'bot' &&
    operationSource === 'bot-runtime-startup-recovery'
  ) {
    return 'Bot Runtime Recovery';
  }
  if (isRuntimeApplyEvent(event) && runtimeConsumer !== null) {
    return runtimeConsumer === 'unknown'
      ? 'Runtime Consumer'
      : `${runtimeConsumerDisplayLabel(runtimeConsumer)} Runtime`;
  }
  if (operationSource === 'studio-runtime') return 'Studio Runtime';
  if (operationSource === 'bot-runtime') return 'Bot Runtime';
  if (operationSource === 'bot-runtime-startup-recovery') return 'Bot Runtime Recovery';
  if (operationSource === 'dashboard') return 'Herta Studio';
  if (operationSource === 'discord') return 'Discord';
  if (event.startsWith('plugin.')) return 'Herta Studio';
  if (event.startsWith('moderation.automatic.')) return 'Herta Bot';
  return null;
}

function resolveRuntimeConsumer(
  event: string,
  metadata: Record<string, Prisma.JsonValue> | null,
): RuntimeConsumerResolution {
  if (!isRuntimeApplyEvent(event)) return null;
  const value = metadata?.['consumer'];
  if (value === undefined) return DEFAULT_PLUGIN_RUNTIME_CONSUMER;
  return isPluginRuntimeConsumer(value) ? value : 'unknown';
}

function runtimeConsumerDisplayLabel(consumer: RuntimeConsumerResolution): string {
  if (consumer === 'bot') return 'Bot';
  if (consumer === 'worker') return 'Worker';
  return 'Runtime consumer';
}

function isRuntimeApplyEvent(event: string): boolean {
  return event === 'plugin.runtime_apply_succeeded' || event === 'plugin.runtime_apply_failed';
}

function resolveTargetLabel(
  targetType: string | null,
  targetId: string | null,
  quoteNumber: number | null,
): string {
  if (targetType === 'quote' && quoteNumber !== null) return `Quote #${quoteNumber}`;
  if (targetType === 'plugin' && targetId) return `Plugin: ${targetId}`;
  if (targetType && targetId) return `${targetType}: ${targetId}`;
  if (targetType) return targetType;
  return '対象情報なし';
}

function resolveActorLabel(
  actorType: string,
  user: { username: string; discriminator: string | null } | undefined,
): string {
  if (actorType === 'bot') return 'Herta Bot';
  if (actorType === 'system') return 'システム';
  if (actorType === 'service') return 'Herta Service';
  if (!user) return 'Discordユーザー';
  if (user.discriminator && user.discriminator !== '0') {
    return `${user.username}#${user.discriminator}`;
  }
  return user.username;
}

function normalizeDateInput(value: string | null): string {
  const normalized = value?.trim() ?? '';
  return parseCalendarDate(normalized) ? normalized : '';
}

function parseJstDate(value: string, endExclusive: boolean): Date | null {
  const parts = parseCalendarDate(value);
  if (!parts) return null;

  const utcMidnight = new Date(0);
  utcMidnight.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  utcMidnight.setUTCHours(0, 0, 0, 0);
  return new Date(utcMidnight.getTime() - JST_OFFSET_MS + (endExclusive ? DAY_MS : 0));
}

function parseCalendarDate(value: string): CalendarDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(0);
  candidate.setUTCFullYear(year, month - 1, day);
  candidate.setUTCHours(0, 0, 0, 0);

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function positiveInteger(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function discordErrorCodeValue(value: Prisma.JsonValue | undefined): string | number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  return typeof value === 'string' && /^\d{1,10}$/u.test(value) ? value : null;
}

function httpStatusValue(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function booleanValue(value: Prisma.JsonValue | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringValue(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}
