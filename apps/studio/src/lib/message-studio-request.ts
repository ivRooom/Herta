import {
  DailyContentValidationError,
  parseLocalDateTime,
} from '@herta/plugin-catalog/daily-content-service';

const ISO_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;

export function normalizeMessageStudioRequestBody(
  body: Record<string, unknown>,
  defaultTimezone: string,
): Record<string, unknown> {
  const normalized = { ...body };
  const onceAt = normalized.onceAt;
  if (typeof onceAt === 'string' && onceAt.trim()) {
    const value = onceAt.trim();
    const timezone =
      typeof normalized.timezone === 'string' && normalized.timezone.trim()
        ? normalized.timezone.trim()
        : defaultTimezone;
    if (ISO_OFFSET_PATTERN.test(value)) {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new DailyContentValidationError('onceAtの日時形式が不正です');
      }
      normalized.onceAt = parsed;
    } else {
      normalized.onceAt = parseLocalDateTime(value.replace('T', ' '), timezone);
    }
  }
  return normalized;
}
