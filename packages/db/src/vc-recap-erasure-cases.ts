import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';

/**
 * 録音削除申請のケース (#750 方式B)。fence の正本は vc_recap_erasure_requests
 * (行の存在が遮断条件) で、そちらは変更しない。本モジュールは申請単位の
 * 履歴・審査状態・チケット紐付けを担う。Web 側チケットが利用者向け状態の
 * 正本、こちらが実行の正本で、紐付けは ticketId + requestId で双方向に持つ。
 * requestId は契約 v1.1 の erasureRequestId と同一の冪等キー。
 * 理由は Herta 側にのみ保持し、チケット (Web) へは送らない。
 */
export const VC_RECAP_ERASURE_CASE_STATUSES = [
  'requested',
  'on_hold',
  'approved',
  'rejected',
  'executing',
  'completed',
  'failed',
] as const;
export type VcRecapErasureCaseStatus = (typeof VC_RECAP_ERASURE_CASE_STATUSES)[number];

/** 未完了のケース。この状態の間は同一ユーザーの新規申請を受け付けない。 */
export const VC_RECAP_ERASURE_OPEN_CASE_STATUSES: readonly VcRecapErasureCaseStatus[] = [
  'requested',
  'on_hold',
  'approved',
  'executing',
  'failed',
];

/** 初段で実行する唯一の消去範囲 (録音単位は T5 で分離)。 */
export const VC_RECAP_ERASURE_SCOPE_ALL = 'all';

export interface VcRecapErasureCaseRecord {
  id: string;
  requestId: string;
  userId: string;
  guildId: string | null;
  ticketId: string | null;
  scope: string;
  recordingIds: string[];
  reason: string | null;
  status: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  executedAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateVcRecapErasureCaseInput {
  userId: string;
  guildId?: string | null;
  reason?: string | null;
  /** 冪等キー。省略時は新しい UUID を採番する。 */
  requestId?: string;
}

export interface CreateVcRecapErasureCaseResult {
  erasureCase: VcRecapErasureCaseRecord;
  /** false は未完了の既存ケースを返した (重複申請の抑止) ことを表す。 */
  created: boolean;
}

/**
 * 削除申請のチケット連携 (#750 方式B) の有効化フラグ。既定は OFF で、
 * OFF の間 /herta-privacy delete-voice-data は従来どおり即時削除する。
 * 開発 Guild で検証してから本番で有効化する (設計 E8)。
 */
export function isVcRecapErasureTicketLinkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['VC_RECAP_ERASURE_TICKET_LINK_ENABLED'] === 'true';
}

/** 未完了のケースがあればそれを返す。無ければ null。 */
export async function findOpenVcRecapErasureCase(
  prisma: PrismaClient,
  userId: string,
): Promise<VcRecapErasureCaseRecord | null> {
  const row = await prisma.vcRecapErasureCase.findFirst({
    where: { userId, status: { in: [...VC_RECAP_ERASURE_OPEN_CASE_STATUSES] } },
    orderBy: { createdAt: 'asc' },
  });
  return row ?? null;
}

/**
 * ケースを登録する。未完了のケースがある間は新規ケースを作らず既存を返す
 * (fence の upsert が冪等なのと対になる重複排除)。fence・同意失効と同じ
 * ユーザー単位 advisory lock の下で判定するため、同時実行された申請でも
 * ケースは1件だけが作られる。呼び出し側は fence (requestVcRecapErasure) を
 * 先に適用しておくこと。本関数は fence を変更しない。
 */
export async function createVcRecapErasureCase(
  prisma: PrismaClient,
  input: CreateVcRecapErasureCaseInput,
): Promise<CreateVcRecapErasureCaseResult> {
  return prisma.$transaction(async (tx) => {
    await lockVcRecapStorageOwner(tx, input.userId);
    const existing = await tx.vcRecapErasureCase.findFirst({
      where: {
        userId: input.userId,
        status: { in: [...VC_RECAP_ERASURE_OPEN_CASE_STATUSES] },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      return { erasureCase: existing, created: false };
    }
    const created = await tx.vcRecapErasureCase.create({
      data: {
        requestId: input.requestId ?? randomUUID(),
        userId: input.userId,
        guildId: input.guildId ?? null,
        scope: VC_RECAP_ERASURE_SCOPE_ALL,
        recordingIds: [],
        reason: input.reason ?? null,
        status: 'requested',
      },
    });
    return { erasureCase: created, created: true };
  });
}
