import { parseLocalDateTime } from '@herta/plugin-catalog/daily-content-service';

export function normalizeMessageStudioRequestBody(
  body: Record<string, unknown>,
  defaultTimezone: string,
): Record<string, unknown> {
  const normalized = { ...body };
  const onceAt = normalized.onceAt;
  if (typeof onceAt === 'string' && onceAt.trim()) {
    const timezone =
      typeof normalized.timezone === 'string' && normalized.timezone.trim()
        ? normalized.timezone.trim()
        : defaultTimezone;
    normalized.onceAt = parseLocalDateTime(onceAt.trim().replace('T', ' '), timezone);
  }
  return normalized;
}
