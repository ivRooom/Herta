import { parseAccessGroupMetadata } from './access-group-metadata.ts';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from './studio-access-policy.ts';

/**
 * ivRooom IAM 連携 `herta-iam` v1.1.0(ivRooom/ivrm-contracts)の管理操作で使う、
 * 入力の検証・制限・応答の組み立て。ここは DB にも Next.js にも依存しない純粋なロジックだけを置く。
 */

export const IVRM_IAM_CAPABILITIES = [
  'group.update',
  'group.delete',
  'group.member',
  'group.member.batch',
  'policy.attach',
  'policy.attach.batch',
] as const;

export const IVRM_IAM_BODY_MAX_BYTES = 16 * 1024;
/** 一括操作の本文上限。500 件の principal(`{type,id}` 約 46 byte)が約 23 KB になり、16 KiB を超えるため。 */
export const IVRM_IAM_BATCH_BODY_MAX_BYTES = 32 * 1024;
export const IVRM_IAM_BATCH_MAX_ITEMS = 500;
export const IVRM_IAM_MEMBERS_LIMIT_OPTIONS = [25, 50, 100, 500, 1000] as const;
export const IVRM_IAM_MEMBERS_LIMIT_DEFAULT = 50;
/** 一括の存在確認(bot への問い合わせ)の同時実行数。 */
export const IVRM_IAM_LOOKUP_CONCURRENCY = 8;

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/u;

export type IamPrincipalType = 'role' | 'user' | 'group';
export type IamPrincipal = { type: IamPrincipalType; id: string };

export type BatchItemErrorCode =
  | 'invalid_id'
  | 'not_a_guild_member'
  | 'role_not_found'
  | 'group_not_found'
  | 'root_role_not_allowed'
  | 'duplicate_in_both_lists';

export type BatchItemError = {
  list: 'add' | 'remove' | 'attach' | 'detach';
  index: number;
  code: BatchItemErrorCode;
};

export function parseDiscordId(value: unknown): string | null {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value) ? value : null;
}

/** UUID は API 境界で小文字に正規化する。 */
export function parseUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function parsePrincipal(type: unknown, id: unknown): IamPrincipal | null {
  if (type === 'role' || type === 'user') {
    const principalId = parseDiscordId(id);
    return principalId ? { type, id: principalId } : null;
  }
  if (type === 'group') {
    const principalId = parseUuid(id);
    return principalId ? { type: 'group', id: principalId } : null;
  }
  return null;
}

export function parseExpectedUpdatedAt(value: unknown): Date | null {
  if (typeof value !== 'string' || !RFC3339_PATTERN.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type GroupUpdateInput = {
  name: string;
  description: string | null;
  expectedUpdatedAt: Date;
};

export function parseGroupUpdateBody(
  value: unknown,
): { ok: true; value: GroupUpdateInput } | { ok: false; message: string } {
  const metadata = parseAccessGroupMetadata(value);
  if (!metadata.ok) {
    return { ok: false, message: 'Group name or description is invalid' };
  }
  const expected = parseExpectedUpdatedAt((value as Record<string, unknown>).expectedUpdatedAt);
  if (!expected) return { ok: false, message: 'expectedUpdatedAt is required' };
  return { ok: true, value: { ...metadata.value, expectedUpdatedAt: expected } };
}

export type GroupDeleteOptions = {
  expectedUpdatedAt: Date;
  cascade: boolean;
  membersLimit: number;
};

export function parseGroupDeleteOptions(
  searchParams: URLSearchParams,
): { ok: true; value: GroupDeleteOptions } | { ok: false; message: string } {
  const expected = parseExpectedUpdatedAt(searchParams.get('expectedUpdatedAt'));
  if (!expected) return { ok: false, message: 'expectedUpdatedAt is required' };

  const cascadeRaw = searchParams.get('cascade');
  if (cascadeRaw !== null && cascadeRaw !== 'true' && cascadeRaw !== 'false') {
    return { ok: false, message: 'cascade must be true or false' };
  }

  const limitRaw = searchParams.get('membersLimit');
  let membersLimit: number = IVRM_IAM_MEMBERS_LIMIT_DEFAULT;
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (!(IVRM_IAM_MEMBERS_LIMIT_OPTIONS as readonly number[]).includes(parsed)) {
      return { ok: false, message: 'membersLimit must be one of 25, 50, 100, 500, 1000' };
    }
    membersLimit = parsed;
  }

  return {
    ok: true,
    value: { expectedUpdatedAt: expected, cascade: cascadeRaw === 'true', membersLimit },
  };
}

export type BatchParseFailure =
  | { ok: false; kind: 'invalid'; message: string }
  | { ok: false; kind: 'items'; itemErrors: BatchItemError[] };

function readList(record: Record<string, unknown>, key: string): unknown[] | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type MemberBatchInput = {
  /** 重複を除いた、適用する user id(元の並びを保つ)。 */
  add: string[];
  remove: string[];
  /** `add` の各要素が、リクエスト上で最初に現れた位置(検証エラーの `index` に使う)。 */
  addIndexes: number[];
};

export function parseMemberBatch(
  value: unknown,
): { ok: true; value: MemberBatchInput } | BatchParseFailure {
  if (!isRecord(value)) return { ok: false, kind: 'invalid', message: 'JSON object is required' };
  const add = readList(value, 'add');
  const remove = readList(value, 'remove');
  if (add === null || remove === null) {
    return { ok: false, kind: 'invalid', message: 'add and remove must be arrays' };
  }
  const total = (add?.length ?? 0) + (remove?.length ?? 0);
  if (total < 1 || total > IVRM_IAM_BATCH_MAX_ITEMS) {
    return { ok: false, kind: 'invalid', message: 'A batch must contain 1 to 500 items' };
  }

  const itemErrors: BatchItemError[] = [];
  const parse = (list: 'add' | 'remove', items: unknown[] | undefined) => {
    const ids: string[] = [];
    const indexes: number[] = [];
    const seen = new Set<string>();
    (items ?? []).forEach((item, index) => {
      const id = parseDiscordId(item);
      if (!id) {
        itemErrors.push({ list, index, code: 'invalid_id' });
        return;
      }
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
        indexes.push(index);
      }
    });
    return { ids, indexes };
  };
  const { ids: addIds, indexes: addIndexes } = parse('add', add);
  const { ids: removeIds } = parse('remove', remove);

  const addSet = new Set(addIds);
  (remove ?? []).forEach((item, index) => {
    const id = parseDiscordId(item);
    if (id && addSet.has(id))
      itemErrors.push({ list: 'remove', index, code: 'duplicate_in_both_lists' });
  });

  if (itemErrors.length > 0) return { ok: false, kind: 'items', itemErrors };
  return { ok: true, value: { add: addIds, remove: removeIds, addIndexes } };
}

export type AttachmentBatchInput = {
  attach: IamPrincipal[];
  detach: IamPrincipal[];
  /** `attach` の各要素が、リクエスト上で最初に現れた位置(検証エラーの `index` に使う)。 */
  attachIndexes: number[];
};

export function parseAttachmentBatch(
  value: unknown,
): { ok: true; value: AttachmentBatchInput } | BatchParseFailure {
  if (!isRecord(value)) return { ok: false, kind: 'invalid', message: 'JSON object is required' };
  const attach = readList(value, 'attach');
  const detach = readList(value, 'detach');
  if (attach === null || detach === null) {
    return { ok: false, kind: 'invalid', message: 'attach and detach must be arrays' };
  }
  const total = (attach?.length ?? 0) + (detach?.length ?? 0);
  if (total < 1 || total > IVRM_IAM_BATCH_MAX_ITEMS) {
    return { ok: false, kind: 'invalid', message: 'A batch must contain 1 to 500 items' };
  }

  const itemErrors: BatchItemError[] = [];
  const parse = (list: 'attach' | 'detach', items: unknown[] | undefined) => {
    const principals: IamPrincipal[] = [];
    const indexes: number[] = [];
    const seen = new Set<string>();
    (items ?? []).forEach((item, index) => {
      const principal = isRecord(item) ? parsePrincipal(item.type, item.id) : null;
      if (!principal) {
        itemErrors.push({ list, index, code: 'invalid_id' });
        return;
      }
      const key = principalKey(principal);
      if (!seen.has(key)) {
        seen.add(key);
        principals.push(principal);
        indexes.push(index);
      }
    });
    return { principals, indexes };
  };
  const { principals: attachPrincipals, indexes: attachIndexes } = parse('attach', attach);
  const { principals: detachPrincipals } = parse('detach', detach);

  const attachKeys = new Set(attachPrincipals.map(principalKey));
  (detach ?? []).forEach((item, index) => {
    const principal = isRecord(item) ? parsePrincipal(item.type, item.id) : null;
    if (principal && attachKeys.has(principalKey(principal))) {
      itemErrors.push({ list: 'detach', index, code: 'duplicate_in_both_lists' });
    }
  });

  if (itemErrors.length > 0) return { ok: false, kind: 'items', itemErrors };
  return { ok: true, value: { attach: attachPrincipals, detach: detachPrincipals, attachIndexes } };
}

export function principalKey(principal: IamPrincipal) {
  return `${principal.type}:${principal.id}`;
}

/** 同時実行数を制限した map。bot への問い合わせを一括で投げすぎないために使う。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await mapper(items[index] as T, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export interface PrincipalExistencePorts {
  /** ギルドのロール ID。取得できなければ null(503 にする)。 */
  getRoleIds(): Promise<ReadonlySet<string> | null>;
  hasGuildMember(userId: string): Promise<boolean>;
  groupIds(): Promise<ReadonlySet<string>>;
}

export type AttachCheckResult =
  | { status: 'ok' }
  | { status: 'unavailable' }
  | { status: 'invalid'; errors: Array<{ index: number; code: BatchItemErrorCode }> };

/**
 * 割り当て(attach)対象の存在確認。Studio の `validatePrincipalExists` と同じ不変条件:
 * OWNER root ロールは不可、role / user / group は同じギルドに存在すること。
 * 解除(detach)では呼ばない(stale な割り当てを消せるようにするため)。
 */
export async function checkAttachPrincipals(
  principals: readonly IamPrincipal[],
  ports: PrincipalExistencePorts,
): Promise<AttachCheckResult> {
  const errors: Array<{ index: number; code: BatchItemErrorCode }> = [];

  const needsRoles = principals.some((principal) => principal.type === 'role');
  let roleIds: ReadonlySet<string> | null = new Set();
  if (needsRoles) {
    roleIds = await ports.getRoleIds();
    if (!roleIds) return { status: 'unavailable' };
  }
  const groupIds = principals.some((principal) => principal.type === 'group')
    ? await ports.groupIds()
    : new Set<string>();

  const userChecks = await mapWithConcurrency(
    principals
      .map((principal, index) => ({ principal, index }))
      .filter(({ principal }) => principal.type === 'user'),
    IVRM_IAM_LOOKUP_CONCURRENCY,
    async ({ principal, index }) => ({ index, exists: await ports.hasGuildMember(principal.id) }),
  );
  const missingUsers = new Set(
    userChecks.filter((check) => !check.exists).map((check) => check.index),
  );

  principals.forEach((principal, index) => {
    if (principal.type === 'role') {
      if (principal.id === STUDIO_ROOT_DISCORD_ROLE_ID) {
        errors.push({ index, code: 'root_role_not_allowed' });
      } else if (!roleIds?.has(principal.id)) {
        errors.push({ index, code: 'role_not_found' });
      }
    } else if (principal.type === 'group') {
      if (!groupIds.has(principal.id)) errors.push({ index, code: 'group_not_found' });
    } else if (missingUsers.has(index)) {
      errors.push({ index, code: 'not_a_guild_member' });
    }
  });

  return errors.length > 0 ? { status: 'invalid', errors } : { status: 'ok' };
}

/** user id 一覧(追加対象)がギルドのメンバーか確認する。存在しない要素のインデックスを返す。 */
export async function findMissingGuildMembers(
  userIds: readonly string[],
  hasGuildMember: (userId: string) => Promise<boolean>,
): Promise<number[]> {
  const checks = await mapWithConcurrency(
    userIds,
    IVRM_IAM_LOOKUP_CONCURRENCY,
    async (userId, index) => ({
      index,
      exists: await hasGuildMember(userId),
    }),
  );
  return checks.filter((check) => !check.exists).map((check) => check.index);
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * 固定窓のレート制限。プロセス内メモリなので、複数インスタンスでは各インスタンスごとの上限になる
 * (Herta Studio は単一インスタンス運用。複数に増やす場合は共有ストアへ移す)。
 */
export function createFixedWindowRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let windowStart = Number.NEGATIVE_INFINITY;
  let count = 0;

  return {
    take(): RateLimitDecision {
      const current = now();
      if (current - windowStart >= options.windowMs) {
        windowStart = current;
        count = 0;
      }
      if (count >= options.limit) {
        const retryAfterMs = windowStart + options.windowMs - current;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      count += 1;
      return { allowed: true };
    },
  };
}

export function readRateLimitPerMinute(
  environment: Record<string, string | undefined> = process.env,
) {
  const parsed = Number(environment['IVRM_INTEGRATION_RATE_LIMIT_PER_MINUTE']);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100_000 ? parsed : 120;
}
