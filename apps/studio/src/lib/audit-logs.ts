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
    summary: eventMeta?.summary ?? '管理対象に対する操作が記録されました。',
    category,
    targetLabel: resolveTargetLabel(targetType, targetId, quoteNumber),
    sourceLabel: resolveSourceLabel(event, operationSource),
  };
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

function stringValue(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}
