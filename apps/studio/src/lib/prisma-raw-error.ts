export function isPrismaRawUniqueViolation(
  error: unknown,
  constraintName?: string,
): boolean {
  if (!isRecord(error) || error.code !== 'P2010') return false;
  const meta = isRecord(error.meta) ? error.meta : null;
  if (meta?.code !== '23505') return false;
  if (!constraintName) return true;

  const messages = [
    typeof error.message === 'string' ? error.message : '',
    typeof meta.message === 'string' ? meta.message : '',
  ];
  return messages.some((message) => message.includes(constraintName));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
