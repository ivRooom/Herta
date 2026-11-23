import { Pool } from 'pg';
import type { PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';

/**
 * ivrm-web #1646 (Herta #971): Activity XP emitter の運用可視化のための状態 push。
 *
 * 管理画面は ivrm-web Admin に集約する方針のため、Studio には状態画面を足さず、
 * emitter の送信サイクルのたびに `activity_xp_event_outbox` の集計を ivrm_api の
 * `xp_emitter_status` へ guild 単位で upsert する。Admin はこのスナップショットと
 * xp_events の到着状況を対で表示する。
 *
 * 前例は apps/worker の achievement-notifications.ts (IVRM_API_DATABASE_URL で
 * ivrm_api へ接続し、スキーマ修飾 `ivrm_api.<table>` で読み書きする)。
 *
 * fail-soft が絶対条件: テーブル未作成・DB 不達など、push の失敗はログに残すだけ
 * で、送信サイクルを止めたり遅らせたりしない。呼び出し側は戻り値 (成功可否) を
 * 見るだけで、例外は伝播しない。
 */

/** ivrm_api.xp_emitter_status の1行分 (Admin 表示用のスナップショット)。 */
export interface XpEmitterStatusSnapshot {
  guildId: string;
  pendingCount: number;
  sentCount: number;
  droppedCount: number;
  failedCount: number;
  /** dropped のうち last_status = 409 (未連携 / payload競合)。 */
  dropped409Count: number;
  /** dropped のうち last_status = 422 (ポリシー外 / 日次上限超過)。 */
  dropped422Count: number;
  /** dropped のうち上記以外 (last_status が NULL の場合を含む)。 */
  droppedOtherCount: number;
  lastSentAt: string | null;
  lastCreatedAt: string | null;
  oldestPendingAt: string | null;
  reportedAt: string;
}

/** outbox 集計の生結果。buildXpEmitterStatusSnapshot への入力。 */
export interface ActivityXpOutboxStatusSource {
  statusCounts: ReadonlyArray<{ status: string; count: number }>;
  droppedStatusCounts: ReadonlyArray<{ lastStatus: number | null; count: number }>;
  lastSentAt: Date | null;
  lastCreatedAt: Date | null;
  oldestPendingAt: Date | null;
}

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * 集計の生結果をスナップショットへ変換する純粋関数。
 * 未知の status は無視し、欠けている status は 0 として扱う。
 */
export function buildXpEmitterStatusSnapshot(
  guildId: string,
  source: ActivityXpOutboxStatusSource,
  reportedAt: Date,
): XpEmitterStatusSnapshot {
  const byStatus = new Map(source.statusCounts.map((row) => [row.status, row.count]));
  let dropped409Count = 0;
  let dropped422Count = 0;
  let droppedOtherCount = 0;
  for (const row of source.droppedStatusCounts) {
    if (row.lastStatus === 409) dropped409Count += row.count;
    else if (row.lastStatus === 422) dropped422Count += row.count;
    else droppedOtherCount += row.count;
  }
  return {
    guildId,
    pendingCount: byStatus.get('pending') ?? 0,
    sentCount: byStatus.get('sent') ?? 0,
    droppedCount: byStatus.get('dropped') ?? 0,
    failedCount: byStatus.get('failed') ?? 0,
    dropped409Count,
    dropped422Count,
    droppedOtherCount,
    lastSentAt: toIsoOrNull(source.lastSentAt),
    lastCreatedAt: toIsoOrNull(source.lastCreatedAt),
    oldestPendingAt: toIsoOrNull(source.oldestPendingAt),
    reportedAt: reportedAt.toISOString(),
  };
}

/**
 * Herta DB の outbox を guild 単位で集計する。件数は groupBy、日時は aggregate で
 * DB 側に寄せ、行そのものは読み出さない (outbox は送信済み行が残り続けるため)。
 */
export async function collectActivityXpOutboxStatusSource(
  prisma: PrismaClient,
  guildId: string,
): Promise<ActivityXpOutboxStatusSource> {
  const [statusGroups, droppedGroups, maxAggregate, pendingAggregate] = await Promise.all([
    prisma.activityXpEventOutbox.groupBy({
      by: ['status'],
      where: { guildId },
      _count: { _all: true },
    }),
    prisma.activityXpEventOutbox.groupBy({
      by: ['lastStatus'],
      where: { guildId, status: 'dropped' },
      _count: { _all: true },
    }),
    prisma.activityXpEventOutbox.aggregate({
      where: { guildId },
      _max: { sentAt: true, createdAt: true },
    }),
    prisma.activityXpEventOutbox.aggregate({
      where: { guildId, status: 'pending' },
      _min: { createdAt: true },
    }),
  ]);
  return {
    statusCounts: statusGroups.map((row) => ({ status: row.status, count: row._count._all })),
    droppedStatusCounts: droppedGroups.map((row) => ({
      lastStatus: row.lastStatus,
      count: row._count._all,
    })),
    lastSentAt: maxAggregate._max.sentAt,
    lastCreatedAt: maxAggregate._max.createdAt,
    oldestPendingAt: pendingAggregate._min.createdAt,
  };
}

/**
 * xp_emitter_status への upsert 文とパラメータを組み立てる純粋関数。
 * created_at は初回 insert の値 (最初の reported_at) を保持し、更新では触らない。
 */
export function buildXpEmitterStatusUpsert(snapshot: XpEmitterStatusSnapshot): {
  sql: string;
  params: unknown[];
} {
  const sql = `INSERT INTO ivrm_api.xp_emitter_status (
      guild_id, pending_count, sent_count, dropped_count, failed_count,
      dropped_409_count, dropped_422_count, dropped_other_count,
      last_sent_at, last_created_at, oldest_pending_at,
      reported_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (guild_id) DO UPDATE SET
      pending_count = EXCLUDED.pending_count,
      sent_count = EXCLUDED.sent_count,
      dropped_count = EXCLUDED.dropped_count,
      failed_count = EXCLUDED.failed_count,
      dropped_409_count = EXCLUDED.dropped_409_count,
      dropped_422_count = EXCLUDED.dropped_422_count,
      dropped_other_count = EXCLUDED.dropped_other_count,
      last_sent_at = EXCLUDED.last_sent_at,
      last_created_at = EXCLUDED.last_created_at,
      oldest_pending_at = EXCLUDED.oldest_pending_at,
      reported_at = EXCLUDED.reported_at,
      updated_at = EXCLUDED.updated_at`;
  const params: unknown[] = [
    snapshot.guildId,
    snapshot.pendingCount,
    snapshot.sentCount,
    snapshot.droppedCount,
    snapshot.failedCount,
    snapshot.dropped409Count,
    snapshot.dropped422Count,
    snapshot.droppedOtherCount,
    snapshot.lastSentAt,
    snapshot.lastCreatedAt,
    snapshot.oldestPendingAt,
    snapshot.reportedAt,
    snapshot.reportedAt,
    snapshot.reportedAt,
  ];
  return { sql, params };
}

/** ivrm_api への書き込み口。テストでは fake に差し替える。 */
export interface XpEmitterStatusWriter {
  upsert(snapshot: XpEmitterStatusSnapshot): Promise<void>;
  close(): Promise<void>;
}

export function createPgXpEmitterStatusWriter(connectionString: string): XpEmitterStatusWriter {
  const pool = new Pool({ connectionString, max: 1 });
  return {
    async upsert(snapshot: XpEmitterStatusSnapshot): Promise<void> {
      const { sql, params } = buildXpEmitterStatusUpsert(snapshot);
      await pool.query(sql, params);
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/**
 * outbox を集計して ivrm_api へ push する fail-soft な入口。
 *
 * - `IVRM_API_DATABASE_URL` が無ければ何もしない (false)。
 * - 集計・接続・書き込みのいずれが失敗しても例外を投げず、warn ログを残して
 *   false を返す。テーブル未作成 (ivrm-web 側スライス未適用) の間もこの形で
 *   吸収される。
 * - Pool は報告のたびに作って閉じる。送信 tick は数分間隔で、接続の張り直し
 *   コストよりライフサイクル管理の単純さを優先する。
 */
export async function reportActivityXpEmitterStatus(options: {
  prisma: PrismaClient;
  guildId: string;
  env: Partial<Record<string, string | undefined>>;
  logger: Logger;
  now?: Date;
  createWriter?: (connectionString: string) => XpEmitterStatusWriter;
}): Promise<boolean> {
  const connectionString = options.env['IVRM_API_DATABASE_URL']?.trim();
  if (!connectionString) return false;
  const createWriter = options.createWriter ?? createPgXpEmitterStatusWriter;
  let writer: XpEmitterStatusWriter | undefined;
  try {
    const source = await collectActivityXpOutboxStatusSource(options.prisma, options.guildId);
    const snapshot = buildXpEmitterStatusSnapshot(
      options.guildId,
      source,
      options.now ?? new Date(),
    );
    writer = createWriter(connectionString);
    await writer.upsert(snapshot);
    return true;
  } catch (error) {
    options.logger.warn(
      { err: error, guildId: options.guildId },
      'XP emitter状態スナップショットの送信に失敗しました (送信サイクルには影響しません)',
    );
    return false;
  } finally {
    if (writer) await writer.close().catch(() => undefined);
  }
}
