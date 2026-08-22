import { createHash } from 'node:crypto';
import { parseAccessGroupMetadata, type AccessGroupMetadata } from './access-group-metadata.ts';

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/u;

export const IVRM_IAM_GROUP_BODY_MAX_BYTES = 16 * 1024;

export type IvrmIamMutationContext = {
  actorId: string;
  idempotencyKey: string;
};

export type IvrmIamGroupCreateInput = AccessGroupMetadata;

export type IvrmIamGroupCreateResponseGroup = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
};

export function readIvrmIamMutationContext(request: Request): IvrmIamMutationContext | null {
  const actorId = request.headers.get('x-ivrm-actor-id') ?? '';
  const idempotencyKey = request.headers.get('idempotency-key') ?? '';

  if (!DISCORD_SNOWFLAKE_PATTERN.test(actorId)) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) return null;

  return { actorId, idempotencyKey };
}

export function isIvrmIamJsonRequest(request: Request) {
  const contentType = request.headers.get('content-type');
  if (!contentType) return false;

  const [mediaType] = contentType.split(';', 1);
  return mediaType.trim().toLowerCase() === 'application/json';
}

export function parseIvrmIamGroupCreateInput(value: unknown): IvrmIamGroupCreateInput | null {
  const parsed = parseAccessGroupMetadata(value);
  return parsed.ok ? parsed.value : null;
}

export function serializeIvrmIamGroupCreateResponse(
  group: IvrmIamGroupCreateResponseGroup,
  replayed: boolean,
) {
  return {
    status: 'ok' as const,
    replayed,
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      updatedAt: group.updatedAt.toISOString(),
    },
  };
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
