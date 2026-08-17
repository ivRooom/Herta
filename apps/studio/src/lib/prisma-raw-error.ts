export function isPrismaRawUniqueViolation(error: unknown): boolean {
  if (!isRecord(error) || error.code !== 'P2010') return false;
  const meta = isRecord(error.meta) ? error.meta : null;
  return meta?.code === '23505';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
