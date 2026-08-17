import { containsExactJsonStringValue } from '@herta/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const ROLE_NAME_MAX_LENGTH = 100;
const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const MIN_LIFETIME_MS = 60 * 1000;

export interface DiscordRoleLifecycleCreateInput {
  requestId: string;
  name: string;
  color: number;
  colorHex: string;
  hoist: boolean;
  mentionable: boolean;
  createAt: Date | null;
  expiresAt: Date | null;
}

export interface DiscordRoleLifecycleValidationResult {
  valid: boolean;
  input?: DiscordRoleLifecycleCreateInput;
  errors: string[];
}

export function validateDiscordRoleLifecycleCreate(
  value: unknown,
  now = new Date(),
): DiscordRoleLifecycleValidationResult {
  if (!isRecord(value)) return invalid('JSONオブジェクトが必要です');
  const errors: string[] = [];
  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const colorHex = typeof value.color === 'string' ? value.color.trim().toUpperCase() : '';
  const hoist = value.hoist;
  const mentionable = value.mentionable;

  if (!UUID_PATTERN.test(requestId)) errors.push('requestIdが不正です');
  if (!name || name.length > ROLE_NAME_MAX_LENGTH) {
    errors.push('Role名は1〜100文字で指定してください');
  }
  if (!HEX_COLOR_PATTERN.test(colorHex)) errors.push('色は#RRGGBB形式で指定してください');
  if (typeof hoist !== 'boolean') errors.push('hoistはbooleanで指定してください');
  if (typeof mentionable !== 'boolean') errors.push('mentionableはbooleanで指定してください');

  const createAt = parseOptionalDate(value.createAt, 'createAt', errors);
  const expiresAt = parseOptionalDate(value.expiresAt, 'expiresAt', errors);
  const nowMs = now.getTime();
  const effectiveCreateAt = createAt ?? now;
  if (createAt && createAt.getTime() <= nowMs) {
    errors.push('予約作成日時は現在より後にしてください');
  }
  if (createAt && createAt.getTime() - nowMs > MAX_SCHEDULE_AHEAD_MS) {
    errors.push('予約作成日時は366日以内にしてください');
  }
  if (expiresAt) {
    if (expiresAt.getTime() - effectiveCreateAt.getTime() < MIN_LIFETIME_MS) {
      errors.push('削除日時は作成予定時刻の1分以上後にしてください');
    }
    if (expiresAt.getTime() - effectiveCreateAt.getTime() > MAX_SCHEDULE_AHEAD_MS) {
      errors.push('Roleの有効期間は366日以内にしてください');
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    input: {
      requestId,
      name,
      color: Number.parseInt(colorHex.slice(1), 16),
      colorHex,
      hoist: hoist as boolean,
      mentionable: mentionable as boolean,
      createAt,
      expiresAt,
    },
    errors: [],
  };
}

export function containsDiscordRoleReference(value: unknown, roleId: string): boolean {
  return containsExactJsonStringValue(value, roleId);
}

export function lifecycleStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '待機中';
    case 'running':
      return '実行中';
    case 'completed':
      return '完了';
    case 'failed':
      return '失敗';
    case 'attention':
      return '要確認';
    case 'canceled':
      return 'キャンセル';
    default:
      return '不明';
  }
}

function parseOptionalDate(value: unknown, field: string, errors: string[]): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    errors.push(`${field}はISO日時で指定してください`);
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors.push(`${field}が不正です`);
    return null;
  }
  return date;
}

function invalid(error: string): DiscordRoleLifecycleValidationResult {
  return { valid: false, errors: [error] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
