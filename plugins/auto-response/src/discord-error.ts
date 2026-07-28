export interface SanitizedDiscordSendError {
  errorName: string;
  errorCode: string | number | null;
  httpStatus: number | null;
}

const MAX_ERROR_TOKEN_LENGTH = 80;

/** Discord送信エラーから本文・request body・stackを除外した識別情報だけを返す。 */
export function sanitizeDiscordSendError(error: unknown): SanitizedDiscordSendError {
  const record = isRecord(error) ? error : {};
  return {
    errorName: sanitizeErrorName(error),
    errorCode: sanitizeErrorCode(record.code),
    httpStatus: sanitizeHttpStatus(record.status),
  };
}

function sanitizeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'DiscordSendError';
  const name = error.name.trim();
  if (!name || name === 'Error') return 'DiscordSendError';
  return sanitizeToken(name) || 'DiscordSendError';
}

function sanitizeErrorCode(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string') return null;
  return sanitizeToken(value);
}

function sanitizeHttpStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function sanitizeToken(value: string): string | null {
  const token = value
    .slice(0, MAX_ERROR_TOKEN_LENGTH)
    .replace(/[^A-Za-z0-9_.:[\]-]/g, '')
    .trim();
  return token || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
