export type VcRecapExportFormat = 'json' | 'csv';

export interface VcRecapExportFilters {
  format: VcRecapExportFormat;
  sessionIds: string[];
  channelId: string | null;
  speakerId: string | null;
  from: Date | null;
  toExclusive: Date | null;
}

export interface VcRecapExportRecord {
  sessionId: string;
  guildId: string;
  channelId: string;
  sessionStartedAt: Date;
  sessionEndedAt: Date | null;
  userId: string;
  segmentId: string;
  startedAt: Date;
  endedAt: Date;
  text: string;
  summary: string | null;
  topics: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SNOWFLAKE = /^\d{17,20}$/u;
const DAY_MS = 86_400_000;

export function parseVcRecapExportFilters(input: URLSearchParams): VcRecapExportFilters | null {
  const format = input.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') return null;

  const rawIds = input.get('sessionIds') ?? '';
  const sessionIds = [...new Set(rawIds ? rawIds.split(',').map((id) => id.trim()) : [])];
  if (sessionIds.length > 50 || sessionIds.some((id) => !UUID.test(id))) return null;

  const channelId = input.get('channelId') || null;
  const speakerId = input.get('speakerId') || null;
  if ((channelId && !SNOWFLAKE.test(channelId)) || (speakerId && !SNOWFLAKE.test(speakerId))) {
    return null;
  }

  const from = parseDay(input.get('from'));
  const to = parseDay(input.get('to'));
  if (from === undefined || to === undefined) return null;
  const toExclusive = to ? new Date(to.getTime() + DAY_MS) : null;
  if (
    from &&
    toExclusive &&
    (toExclusive <= from || toExclusive.getTime() - from.getTime() > 366 * DAY_MS)
  ) {
    return null;
  }
  // Large historical requests must be scoped to 50 named sessions or <=366 days.
  if (sessionIds.length === 0 && (!from || !toExclusive)) return null;
  return { format, sessionIds, channelId, speakerId, from, toExclusive };
}

function parseDay(value: string | null): Date | null | undefined {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  const localDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return localDay === value ? date : undefined;
}

const CSV_COLUMNS = [
  'sessionId',
  'guildId',
  'channelId',
  'sessionStartedAt',
  'sessionEndedAt',
  'userId',
  'segmentId',
  'startedAt',
  'endedAt',
  'text',
  'summary',
  'topics',
  'exportedAt',
] as const;

export function toVcRecapExportObject(records: readonly VcRecapExportRecord[], exportedAt: Date) {
  return {
    exportedAt: exportedAt.toISOString(),
    count: records.length,
    records: records.map((record) => ({
      ...record,
      sessionStartedAt: record.sessionStartedAt.toISOString(),
      sessionEndedAt: record.sessionEndedAt?.toISOString() ?? null,
      startedAt: record.startedAt.toISOString(),
      endedAt: record.endedAt.toISOString(),
    })),
  };
}

/** CR/LFを単一セル内に封じ、危険な数式開始文字を無効化する。 */
export function escapeVcRecapCsvCell(value: unknown): string {
  const plain = String(value ?? '').replace(/[\r\n\t\u0000-\u001f]+/gu, ' ');
  const safe = /^[\s]*[=+@-]/u.test(plain) ? `'${plain}` : plain;
  return `"${safe.replace(/"/gu, '""')}"`;
}

export function serializeVcRecapCsv(
  records: readonly VcRecapExportRecord[],
  exportedAt: Date,
): string {
  const rows = records.map((record) => {
    const row = {
      ...record,
      sessionStartedAt: record.sessionStartedAt.toISOString(),
      sessionEndedAt: record.sessionEndedAt?.toISOString() ?? '',
      startedAt: record.startedAt.toISOString(),
      endedAt: record.endedAt.toISOString(),
      topics: record.topics.join(' / '),
      exportedAt: exportedAt.toISOString(),
    };
    return CSV_COLUMNS.map((column) => escapeVcRecapCsvCell(row[column])).join(',');
  });
  return '\uFEFF' + CSV_COLUMNS.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
}
