import { createHmac, timingSafeEqual } from 'node:crypto';

export type TeamSplitComponentAction = 'join' | 'leave';

export interface ParsedTeamSplitComponentId {
  action: TeamSplitComponentAction;
  sessionId: string;
  expiresAt: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_LENGTH = 18;

export function createTeamSplitComponentId(
  action: TeamSplitComponentAction,
  sessionId: string,
  expiresAt: Date,
  secret: string,
): string {
  assertSecret(secret);
  if (!UUID_PATTERN.test(sessionId)) throw new Error('sessionIdがUUIDではありません');
  if (!Number.isFinite(expiresAt.getTime())) throw new Error('expiresAtが不正です');
  const expiresUnix = Math.floor(expiresAt.getTime() / 1000);
  const payload = `${action}:${sessionId}:${expiresUnix}`;
  return `team:${payload}:${sign(payload, secret)}`;
}

export function parseTeamSplitComponentId(
  customId: string,
  secret: string,
  now: Date = new Date(),
): ParsedTeamSplitComponentId | null {
  assertSecret(secret);
  const parts = customId.split(':');
  if (parts.length !== 5 || parts[0] !== 'team') return null;
  const action = parts[1];
  const sessionId = parts[2];
  const expiresUnixText = parts[3];
  const signature = parts[4];
  if ((action !== 'join' && action !== 'leave') || !sessionId || !UUID_PATTERN.test(sessionId)) {
    return null;
  }
  if (!expiresUnixText || !/^\d{1,12}$/.test(expiresUnixText) || !signature) return null;
  const expiresUnix = Number.parseInt(expiresUnixText, 10);
  const expiresAt = new Date(expiresUnix * 1000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() < now.getTime()) return null;

  const payload = `${action}:${sessionId}:${expiresUnix}`;
  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  return { action, sessionId, expiresAt };
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url').slice(0, SIGNATURE_LENGTH);
}

function assertSecret(secret: string): void {
  if (secret.length < 32) throw new Error('TEAM_SPLIT_SECRETは32文字以上で設定してください');
}
