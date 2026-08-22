export type AccessGroupMetadata = {
  name: string;
  description: string | null;
};

export type AccessGroupMetadataParseResult =
  | { ok: true; value: AccessGroupMetadata }
  | { ok: false; field: 'name' | 'description' };

export function parseAccessGroupMetadata(value: unknown): AccessGroupMetadataParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, field: 'name' };
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string') return { ok: false, field: 'name' };
  if (
    record.description !== undefined &&
    record.description !== null &&
    typeof record.description !== 'string'
  ) {
    return { ok: false, field: 'description' };
  }

  const name = record.name.trim();
  const description = typeof record.description === 'string' ? record.description.trim() : '';

  if (!isUnicodeCodePointLengthBetween(name, 1, 100)) return { ok: false, field: 'name' };
  if (!isUnicodeCodePointLengthBetween(description, 0, 500)) {
    return { ok: false, field: 'description' };
  }

  return { ok: true, value: { name, description: description || null } };
}

function isUnicodeCodePointLengthBetween(value: string, minimum: number, maximum: number) {
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > maximum) return false;
  }
  return length >= minimum;
}
