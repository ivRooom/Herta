export function containsExactJsonStringValue(
  value: unknown,
  target: string,
  depth = 0,
): boolean {
  if (depth > 16) return false;
  if (typeof value === 'string') return value === target;
  if (Array.isArray(value)) {
    return value.some((item) => containsExactJsonStringValue(item, target, depth + 1));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).some((item) => containsExactJsonStringValue(item, target, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
