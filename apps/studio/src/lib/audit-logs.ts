import type { Prisma, PrismaClient } from '@herta/db';

export type AuditLogCategory = 'all' | 'plugin' | 'quote' | 'other';
export type AuditLogSeverity = 'all' | 'info' | 'warning' | 'error' | 'critical';

export interface AuditLogQuery {
  page: number;
  pageSize: number;
  search: string;
  category: AuditLogCategory;
  severity: AuditLogSeverity;
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

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 100;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_CATEGORIES = new Set<AuditLogCategory>(['all', 'plugin', 'quote', 'other']);
const ALLOWED_SEVERITIES = new Set<AuditLogSeverity>([
  'all',
  'info',
  'warning',
  'error',
  'critical',
]);

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
};

export function parseAuditLogQuery(searchParams: URLSearchParams): AuditLogQuery {
  const categoryValue = searchParams.get('category') ?? 'all';
  const severityValue = searchParams.get('severity') ?? 'all';
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
  };
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

  return {
    eventLabel: eventMeta?.label ?? event,
    summary: resolveAuditSummary(event, metadataRecord, eventMeta?.summary),
    category,
    targetLabel: resolveTargetLabel(targetType, targetId, quoteNumber),
    sourceLabel: resolveSourceLabel(event, operationSource),
  };
}

function resolveAuditSummary(
  event: string,
  metadata: Record<string, Prisma.JsonValue> | null,
  fallback: string | undefined,
): string {
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
  return fallback ?? '管理対象に対する操作が記録されました。';
}

function resolveAutomaticDecisionSummary(
  metadata: Record<string, Prisma.JsonValue> | null,
): string | null {
  if (!metadata) return null;
  const outcome = stringValue(metadata['outcome']);
  const action = stringValue(metadata['action']);
  const severity = stringValue(metadata['severity']);
  const parts = [
    outcome ? `判定: ${decisionOutcomeLabel(outcome)}` : null,
    action ? `対応: ${automaticActionLabel(action)}` : null,
    severity ? `危険度: ${automaticSeverityLabel(severity)}` : null,
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
  const errorCode = stringOrNumberValue(metadata['discordErrorCode']);
  const httpStatus = integerValue(metadata['discordHttpStatus']);
  const parts = [
    actionOutcome ? `実行結果: ${automaticActionOutcomeLabel(actionOutcome)}` : null,
    action ? `対応: ${automaticActionLabel(action)}` : null,
    errorCode === null ? null : `Discord code: ${errorCode}`,
    httpStatus === null ? null : `HTTP: ${httpStatus}`,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' / ') : null;
}

function decisionOutcomeLabel(value: string): string {
  if (value === 'disabled') return '自動対応OFF（実行なし）';
  if (value === 'observe') return '監視のみ';
  if (value === 'execute') return '実行対象';
  return value;
}

function automaticActionOutcomeLabel(value: string): string {
  if (value === 'executed') return '成功';
  if (value === 'already_satisfied') return '既に目的達成';
  if (value === 'failed') return '失敗';
  return value;
}

function automaticActionLabel(value: string): string {
  return AUTOMATIC_ACTION_LABELS[value] ?? value;
}

function automaticSeverityLabel(value: string): string {
  return AUTOMATIC_SEVERITY_LABELS[value] ?? value;
}

function buildAuditLogWhere(guildId: string, query: AuditLogQuery): Prisma.AuditLogWhereInput {
  const filters: Prisma.AuditLogWhereInput[] = [{ guildId }];

  if (query.category === 'plugin') filters.push({ event: { startsWith: 'plugin.' } });
  if (query.category === 'quote') filters.push({ event: { startsWith: 'quote.' } });
  if (query.category === 'other') {
    filters.push({
      NOT: [{ event: { startsWith: 'plugin.' } }, { event: { startsWith: 'quote.' } }],
    });
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
  if (event.startsWith('plugin.')) return 'plugin';
  if (event.startsWith('quote.')) return 'quote';
  return 'other';
}

function resolveSourceLabel(event: string, operationSource: string | null): string | null {
  if (operationSource === 'dashboard') return 'Herta Studio';
  if (operationSource === 'discord') return 'Discord';
  if (event.startsWith('plugin.')) return 'Herta Studio';
  if (event.startsWith('moderation.automatic.')) return 'Herta Bot';
  return null;
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

function integerValue(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function booleanValue(value: Prisma.JsonValue | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringOrNumberValue(value: Prisma.JsonValue | undefined): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function stringValue(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}
