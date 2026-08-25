import type { PrismaClient } from '@herta/db';
import type { SuggestionStatus } from './suggestion-repository.js';

export const SUGGESTION_HISTORY_PAGE_SIZE = 7;
export const SUGGESTION_HISTORY_MAX_PAGE = 100;
const MAX_HISTORY_RESPONSE_LENGTH = 1900;
const MAX_EVENT_NAME_LENGTH = 80;

export interface SuggestionHistoryRecord {
  id: string;
  event: string;
  changes: unknown;
  metadata: unknown;
  createdAt: Date;
}

export interface SuggestionHistoryPage {
  records: SuggestionHistoryRecord[];
  hasNext: boolean;
}

export async function listSuggestionHistory(
  prisma: PrismaClient,
  input: { guildId: string; suggestionId: string; page: number },
): Promise<SuggestionHistoryPage> {
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > SUGGESTION_HISTORY_MAX_PAGE) {
    throw new RangeError('SuggestionHistoryPageOutOfRange');
  }

  const rows = await prisma.auditLog.findMany({
    where: {
      guildId: input.guildId,
      targetType: 'suggestion',
      targetId: input.suggestionId,
      event: { startsWith: 'suggestion.' },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (input.page - 1) * SUGGESTION_HISTORY_PAGE_SIZE,
    take: SUGGESTION_HISTORY_PAGE_SIZE + 1,
    select: {
      id: true,
      event: true,
      changes: true,
      metadata: true,
      createdAt: true,
    },
  });

  return {
    records: rows.slice(0, SUGGESTION_HISTORY_PAGE_SIZE),
    hasNext: input.page < SUGGESTION_HISTORY_MAX_PAGE && rows.length > SUGGESTION_HISTORY_PAGE_SIZE,
  };
}

export function formatSuggestionHistoryPage(
  result: SuggestionHistoryPage,
  suggestionId: string,
  page: number,
): string {
  const header = `**Suggestion History** · Page ${page}\nID: \`${suggestionId}\``;
  if (result.records.length === 0) {
    return `${header}\n\n記録済みのSuggestion履歴はありません。`;
  }

  const entries = result.records.map((record) => {
    const timestamp = Math.floor(record.createdAt.getTime() / 1000);
    return `<t:${timestamp}:R> · ${describeSuggestionAuditEvent(record)}`;
  });
  const footer = result.hasNext
    ? `\n\n次ページ: \`/suggest history id:${suggestionId} page:${page + 1}\``
    : '\n\nこのSuggestionの履歴はここまでです。';
  return truncate([header, '', ...entries].join('\n\n') + footer, MAX_HISTORY_RESPONSE_LENGTH);
}

function describeSuggestionAuditEvent(record: SuggestionHistoryRecord): string {
  const changes = asRecord(record.changes);
  const before = asRecord(changes?.['before']);
  const after = asRecord(changes?.['after']);
  const metadata = asRecord(record.metadata);
  const source = sourceLabel(stringValue(metadata?.['operationSource']));
  const sourceSuffix = source ? ` · ${source}` : '';

  if (record.event === 'suggestion.edit') {
    const beforeLength = nonNegativeInteger(before?.['contentLength']);
    const afterLength = nonNegativeInteger(after?.['contentLength']);
    const lengthSummary =
      beforeLength !== null && afterLength !== null
        ? ` · 本文 ${beforeLength}文字 → ${afterLength}文字`
        : '';
    const votesReset = metadata?.['votesReset'] === true ? ' · 投票リセット' : '';
    const reviewReset = metadata?.['reviewReset'] === true ? ' · reviewリセット' : '';
    const staffNoteRemoved =
      booleanValue(before?.['staffNotePresent']) === true &&
      booleanValue(after?.['staffNotePresent']) === false
        ? ' · Staffコメント削除'
        : '';
    return `✏️ 投稿者編集${lengthSummary}${votesReset}${reviewReset}${staffNoteRemoved}${sourceSuffix}`;
  }

  if (record.event === 'suggestion.withdraw') {
    const beforeStatus = suggestionStatus(before?.['status']);
    const transition = beforeStatus ? ` · ${statusLabel(beforeStatus)} → ↩️ 取下げ` : '';
    return `↩️ 投稿者取下げ${transition}${sourceSuffix}`;
  }

  if (record.event === 'suggestion.status') {
    const beforeStatus = suggestionStatus(before?.['status']);
    const afterStatus = suggestionStatus(after?.['status']);
    const transition =
      beforeStatus && afterStatus
        ? ` · ${statusLabel(beforeStatus)} → ${statusLabel(afterStatus)}`
        : '';
    const noteSummary = describeStaffNoteChange(
      before,
      after,
      booleanValue(metadata?.['staffNoteChanged']),
    );
    return `🛠️ Staff状態変更${transition}${noteSummary}${sourceSuffix}`;
  }

  return `🧾 Suggestion操作 · ${truncate(record.event, MAX_EVENT_NAME_LENGTH)}${sourceSuffix}`;
}

function describeStaffNoteChange(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  staffNoteChanged: boolean | null,
): string {
  const beforePresent = booleanValue(before?.['staffNotePresent']);
  const afterPresent = booleanValue(after?.['staffNotePresent']);
  const beforeLength = nonNegativeInteger(before?.['staffNoteLength']);
  const afterLength = nonNegativeInteger(after?.['staffNoteLength']);

  if (beforePresent === true && afterPresent === false) return ' · Staffコメント削除';
  if (beforePresent === false && afterPresent === true) return ' · Staffコメント追加';
  if (
    beforePresent === true &&
    afterPresent === true &&
    (staffNoteChanged === true ||
      (beforeLength !== null && afterLength !== null && beforeLength !== afterLength))
  ) {
    return ' · Staffコメント更新';
  }
  if (afterPresent === true) return ' · Staffコメントあり';
  return '';
}

function statusLabel(status: SuggestionStatus): string {
  if (status === 'pending') return '未確認';
  if (status === 'reviewing') return '検討中';
  if (status === 'accepted') return '採用';
  if (status === 'rejected') return '却下';
  if (status === 'withdrawn') return '取下げ';
  return '完了';
}

function suggestionStatus(value: unknown): SuggestionStatus | null {
  if (
    value === 'pending' ||
    value === 'reviewing' ||
    value === 'accepted' ||
    value === 'rejected' ||
    value === 'completed' ||
    value === 'withdrawn'
  ) {
    return value;
  }
  return null;
}

function sourceLabel(value: string | null): string | null {
  if (value === 'discord') return 'Discord';
  if (value === 'studio') return 'Studio';
  if (value === 'api') return 'API';
  if (value === 'worker') return 'Worker';
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
