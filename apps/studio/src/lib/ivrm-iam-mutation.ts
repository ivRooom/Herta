import { createHash } from 'node:crypto';

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/u;

export type IvrmIamMutationContext = {
  actorId: string;
  idempotencyKey: string;
};

export type IvrmIamGroupCreateInput = {
  name: string;
  description: string | null;
};

export function readIvrmIamMutationContext(request: Request): IvrmIamMutationContext | null {
  const actorId = request.headers.get('x-ivrm-actor-id')?.trim() ?? '';
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';

  if (!DISCORD_SNOWFLAKE_PATTERN.test(actorId)) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) return null;

  return { actorId, idempotencyKey };
}

export function parseIvrmIamGroupCreateInput(value: unknown): IvrmIamGroupCreateInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string') return null;
  if (
    record.description !== undefined &&
    record.description !== null &&
    typeof record.description !== 'string'
  ) {
    return null;
  }

  const name = record.name.trim();
  const description = typeof record.description === 'string' ? record.description.trim() : '';

  if (name.length < 1 || name.length > 100) return null;
  if (description.length > 500) return null;

  return { name, description: description || null };
}

export function createIvrmIamMutationUuid(
  guildId: string,
  idempotencyKey: string,
  operation: string,
): string {
  const digest = createHash('sha256')
    .update(`ivrm-iam:${operation}:${guildId}:${idempotencyKey}`, 'utf8')
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
