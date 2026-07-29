import { createHmac, timingSafeEqual } from 'node:crypto';

export type LfgComponentAction = 'join' | 'leave';

export interface ParsedLfgComponentId {
  action: LfgComponentAction;
  postId: string;
}

const PREFIX = 'lfg';
const SIGNATURE_LENGTH = 16;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createLfgComponentId(
  action: LfgComponentAction,
  postId: string,
  secret: string,
): string {
  assertSecret(secret);
  if (!UUID_PATTERN.test(postId)) throw new Error('InvalidLfgPostId');
  const payload = `${PREFIX}:${action}:${postId}`;
  return `${payload}:${sign(payload, secret)}`;
}

export function parseLfgComponentId(value: string, secret: string): ParsedLfgComponentId | null {
  try {
    assertSecret(secret);
    const [prefix, action, postId, signature, ...extra] = value.split(':');
    if (
      extra.length > 0 ||
      prefix !== PREFIX ||
      (action !== 'join' && action !== 'leave') ||
      !postId ||
      !UUID_PATTERN.test(postId) ||
      !signature
    ) {
      return null;
    }
    const payload = `${prefix}:${action}:${postId}`;
    const expected = sign(payload, secret);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    return { action, postId };
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

function assertSecret(secret: string): void {
  if (secret.length < 32) throw new Error('LFG_COMPONENT_SECRETは32文字以上で指定してください');
}
