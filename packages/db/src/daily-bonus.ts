import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export interface DailyAnnouncement {
  updated_at: Date;
  eligible_count: number | null;
  eligible_captured_at: Date | null;
  guild_id: string;
  target_date: string;
  channel_id: string;
  role_id: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'disabled';
  message_id: string | null;
  error_code: string | null;
  template_revision_id: string | null;
}
export async function getDailyAnnouncement(db: PrismaClient, guild: string, date: string) {
  const rows = await db.$queryRaw<
    DailyAnnouncement[]
  >`SELECT * FROM daily_bonus_announcements WHERE guild_id=${guild} AND target_date=${date}`;
  return rows[0] ?? null;
}
export async function reserveDailyAnnouncement(
  db: PrismaClient,
  guild: string,
  date: string,
  channel: string,
  role: string,
) {
  await db.$executeRaw`INSERT INTO daily_bonus_announcements(guild_id,target_date,channel_id,role_id) VALUES(${guild},${date},${channel},${role}) ON CONFLICT DO NOTHING`;
  const rows = await db.$queryRaw<
    DailyAnnouncement[]
  >`UPDATE daily_bonus_announcements SET status='sending',channel_id=${channel},role_id=${role},eligible_count=NULL,eligible_captured_at=NULL,updated_at=NOW() WHERE guild_id=${guild} AND target_date=${date} AND status='pending' AND message_id IS NULL RETURNING *`;
  return rows[0] ?? null;
}
export async function captureDailyAnnouncementPopulation(
  db: PrismaClient,
  guild: string,
  date: string,
  role: string,
  snapshot: { count: number; capturedAt: Date } | null,
) {
  await db.$executeRaw`UPDATE daily_bonus_announcements SET eligible_count=${snapshot?.count ?? null},eligible_captured_at=${snapshot?.capturedAt ?? null} WHERE guild_id=${guild} AND target_date=${date} AND role_id=${role} AND status='sending' AND message_id IS NULL`;
}
export async function setDailyAnnouncement(
  db: PrismaClient,
  guild: string,
  date: string,
  status: DailyAnnouncement['status'],
  message: string | null,
  error: string | null,
) {
  await db.$executeRaw`UPDATE daily_bonus_announcements SET status=${status},message_id=${message},error_code=${error},updated_at=NOW() WHERE guild_id=${guild} AND target_date=${date}`;
}
/**
 * Record which template revision a day's announcement used (#766
 * Phase C delivery snapshot). NULL means the plugin config template
 * was in effect. Audit-only: callers treat failures as non-fatal.
 */
export async function setDailyAnnouncementTemplateRevision(
  db: PrismaClient,
  guild: string,
  date: string,
  revisionId: string | null,
) {
  await db.$executeRaw`UPDATE daily_bonus_announcements SET template_revision_id=${revisionId} WHERE guild_id=${guild} AND target_date=${date}`;
}
export async function recordDailyClaim(
  db: PrismaClient,
  guild: string,
  user: string,
  date: string,
  status: string,
  receipt: unknown = null,
) {
  const json = JSON.stringify(receipt);
  await db.$executeRaw`INSERT INTO daily_bonus_claims(guild_id,discord_user_id,target_date,status,receipt_json) VALUES(${guild},${user},${date},${status},${json}::jsonb) ON CONFLICT(guild_id,discord_user_id,target_date) DO UPDATE SET status=EXCLUDED.status,receipt_json=EXCLUDED.receipt_json,updated_at=NOW() WHERE daily_bonus_claims.status<>'confirmed'`;
}
export interface DailyQuizSession {
  id: string;
  guild_id: string;
  discord_user_id: string;
  target_date: string;
  announcement_message_id: string;
  quiz_id: string;
}
export async function createDailyQuizSession(
  db: PrismaClient,
  guild: string,
  user: string,
  date: string,
  message: string,
  quiz: string,
) {
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO daily_bonus_quiz_sessions(id,guild_id,discord_user_id,target_date,announcement_message_id,quiz_id) VALUES(${id},${guild},${user},${date},${message},${quiz})`;
  return id;
}
export async function getDailyQuizSession(
  db: PrismaClient,
  id: string,
  guild: string,
  user: string,
) {
  const rows = await db.$queryRaw<
    DailyQuizSession[]
  >`SELECT * FROM daily_bonus_quiz_sessions WHERE id=${id} AND guild_id=${guild} AND discord_user_id=${user} AND created_at>NOW()-INTERVAL '1 day'`;
  return rows[0] ?? null;
}
/** Result only. Never pass or persist raw profile inputs here. First daily result wins. */
export async function dailyFortuneSnapshot<T>(
  db: PrismaClient,
  guild: string,
  user: string,
  date: string,
  version: string,
  create: () => Promise<T>,
): Promise<T> {
  const existing = await db.$queryRaw<
    Array<{ result_json: T }>
  >`SELECT result_json FROM daily_fortune_results WHERE guild_id=${guild} AND discord_user_id=${user} AND target_date=${date}`;
  if (existing[0]) return existing[0].result_json;
  const result = await create();
  await db.$executeRaw`INSERT INTO daily_fortune_results(guild_id,discord_user_id,target_date,algorithm_version,result_json) VALUES(${guild},${user},${date},${version},${JSON.stringify(result)}::jsonb) ON CONFLICT DO NOTHING`;
  const saved = await db.$queryRaw<
    Array<{ result_json: T }>
  >`SELECT result_json FROM daily_fortune_results WHERE guild_id=${guild} AND discord_user_id=${user} AND target_date=${date}`;
  return saved[0]!.result_json;
}
export interface DailySpecialDayRuleRow {
  id: string;
  guild_id: string;
  kind: 'date' | 'annual';
  exact_date: string | null;
  month_day: string | null;
  title: string | null;
  intro: string | null;
  enabled: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}
export interface DailySpecialDayRuleInput {
  id: string;
  kind: 'date' | 'annual';
  exactDate: string | null;
  monthDay: string | null;
  title: string | null;
  intro: string | null;
  enabled: boolean;
  createdBy: string;
}
/** 特別日ルールの読み書きは通常のクライアントでも対話的トランザクション内でも行える。 */
export type DailySpecialDayRuleDbClient = PrismaClient | Prisma.TransactionClient;
export async function listDailySpecialDayRules(db: DailySpecialDayRuleDbClient, guild: string) {
  return db.$queryRaw<
    DailySpecialDayRuleRow[]
  >`SELECT * FROM daily_special_day_rules WHERE guild_id=${guild} ORDER BY kind DESC, exact_date, month_day, id`;
}
/**
 * Insert or replace one rule owned by the guild. The update path is
 * guarded on the existing row's guild, so a rule id from another
 * guild can never be hijacked; the read-back returns null then.
 */
export async function saveDailySpecialDayRule(
  db: DailySpecialDayRuleDbClient,
  guild: string,
  rule: DailySpecialDayRuleInput,
) {
  await db.$executeRaw`INSERT INTO daily_special_day_rules(id,guild_id,kind,exact_date,month_day,title,intro,enabled,created_by) VALUES(${rule.id},${guild},${rule.kind},${rule.exactDate},${rule.monthDay},${rule.title},${rule.intro},${rule.enabled},${rule.createdBy}) ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,exact_date=EXCLUDED.exact_date,month_day=EXCLUDED.month_day,title=EXCLUDED.title,intro=EXCLUDED.intro,enabled=EXCLUDED.enabled,updated_at=NOW() WHERE daily_special_day_rules.guild_id=EXCLUDED.guild_id`;
  const rows = await db.$queryRaw<
    DailySpecialDayRuleRow[]
  >`SELECT * FROM daily_special_day_rules WHERE id=${rule.id} AND guild_id=${guild}`;
  return rows[0] ?? null;
}
export async function deleteDailySpecialDayRule(
  db: DailySpecialDayRuleDbClient,
  guild: string,
  id: string,
) {
  return db.$executeRaw`DELETE FROM daily_special_day_rules WHERE id=${id} AND guild_id=${guild}`;
}
export type DailyBonusTemplateRevisionStatus =
  'draft' | 'pending_review' | 'approved' | 'active' | 'superseded' | 'rejected';
export interface DailyBonusTemplateRevisionRow {
  id: string;
  guild_id: string;
  revision: number;
  message_template: string;
  status: DailyBonusTemplateRevisionStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  review_note: string | null;
  activated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
/** 本文テンプレートの版管理（#766 Phase C）も特別日ルールと同じく通常・対話的どちらのクライアントでも扱える。 */
export type DailyBonusTemplateRevisionDbClient = PrismaClient | Prisma.TransactionClient;
export async function listDailyBonusTemplateRevisions(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
) {
  return db.$queryRaw<
    DailyBonusTemplateRevisionRow[]
  >`SELECT * FROM daily_bonus_template_revisions WHERE guild_id=${guild} ORDER BY revision DESC`;
}
export async function getDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  id: string,
) {
  const rows = await db.$queryRaw<
    DailyBonusTemplateRevisionRow[]
  >`SELECT * FROM daily_bonus_template_revisions WHERE id=${id} AND guild_id=${guild}`;
  return rows[0] ?? null;
}
export async function getActiveDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
) {
  const rows = await db.$queryRaw<
    DailyBonusTemplateRevisionRow[]
  >`SELECT * FROM daily_bonus_template_revisions WHERE guild_id=${guild} AND status='active'`;
  return rows[0] ?? null;
}
/** Create a draft with the guild's next revision number. */
export async function createDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  input: { id: string; messageTemplate: string; createdBy: string },
) {
  const rows = await db.$queryRaw<DailyBonusTemplateRevisionRow[]>`
    INSERT INTO daily_bonus_template_revisions(id,guild_id,revision,message_template,created_by)
    SELECT ${input.id},${guild},COALESCE(MAX(revision),0)+1,${input.messageTemplate},${input.createdBy}
    FROM daily_bonus_template_revisions WHERE guild_id=${guild}
    RETURNING *`;
  return rows[0]!;
}
/** Edit a draft (or a returned revision, which goes back to draft). Approved content is frozen. */
export async function updateDailyBonusTemplateRevisionDraft(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  id: string,
  messageTemplate: string,
) {
  return db.$executeRaw`UPDATE daily_bonus_template_revisions SET message_template=${messageTemplate},status='draft',approved_by=NULL,approved_at=NULL,updated_at=NOW() WHERE id=${id} AND guild_id=${guild} AND status IN ('draft','rejected')`;
}
export async function submitDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  id: string,
) {
  return db.$executeRaw`UPDATE daily_bonus_template_revisions SET status='pending_review',review_note=NULL,updated_at=NOW() WHERE id=${id} AND guild_id=${guild} AND status IN ('draft','rejected')`;
}
/** Approve a pending revision. The author can never approve their own revision. */
export async function approveDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  id: string,
  actor: string,
) {
  return db.$executeRaw`UPDATE daily_bonus_template_revisions SET status='approved',approved_by=${actor},approved_at=NOW(),updated_at=NOW() WHERE id=${id} AND guild_id=${guild} AND status='pending_review' AND created_by<>${actor}`;
}
export async function returnDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  id: string,
  reviewNote: string | null,
) {
  return db.$executeRaw`UPDATE daily_bonus_template_revisions SET status='rejected',review_note=${reviewNote},updated_at=NOW() WHERE id=${id} AND guild_id=${guild} AND status='pending_review'`;
}
/**
 * Activate an approved revision with a compare-and-swap on the
 * currently active one. Must run inside a transaction: when the
 * target turns out not to be approved, the caller rolls back so the
 * previously active revision stays active.
 */
export async function activateDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  id: string,
  expectedActiveId: string | null,
): Promise<'activated' | 'conflict' | 'not_approved'> {
  const current = await getActiveDailyBonusTemplateRevision(db, guild);
  if ((current?.id ?? null) !== expectedActiveId) return 'conflict';
  if (current) {
    await db.$executeRaw`UPDATE daily_bonus_template_revisions SET status='superseded',updated_at=NOW() WHERE id=${current.id} AND guild_id=${guild} AND status='active'`;
  }
  const count =
    await db.$executeRaw`UPDATE daily_bonus_template_revisions SET status='active',activated_at=NOW(),updated_at=NOW() WHERE id=${id} AND guild_id=${guild} AND status='approved'`;
  if (count !== 1) return 'not_approved';
  return 'activated';
}
/** Take the active revision offline (rollback to the plugin config template), CAS-guarded. */
export async function deactivateDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  expectedActiveId: string,
) {
  return db.$executeRaw`UPDATE daily_bonus_template_revisions SET status='superseded',updated_at=NOW() WHERE id=${expectedActiveId} AND guild_id=${guild} AND status='active'`;
}
export async function deleteDailyBonusTemplateRevision(
  db: DailyBonusTemplateRevisionDbClient,
  guild: string,
  id: string,
) {
  return db.$executeRaw`DELETE FROM daily_bonus_template_revisions WHERE id=${id} AND guild_id=${guild} AND status IN ('draft','rejected')`;
}
export async function hasDailyBonusSchema(db: PrismaClient) {
  const rows = await db.$queryRaw<
    Array<{ ready: boolean }>
  >`SELECT to_regclass('daily_fortune_results') IS NOT NULL AND to_regclass('daily_bonus_claims') IS NOT NULL AND to_regclass('daily_bonus_quiz_sessions') IS NOT NULL AS ready`;
  return rows[0]?.ready === true;
}
export async function cleanDailyBonusHistory(db: PrismaClient) {
  if (!(await hasDailyBonusSchema(db))) return;
  await db.$executeRaw`DELETE FROM daily_bonus_quiz_sessions WHERE created_at<NOW()-INTERVAL '1 day'`;
  await db.$executeRaw`DELETE FROM daily_fortune_results WHERE created_at<NOW()-INTERVAL '180 days'`;
  await db.$executeRaw`DELETE FROM daily_bonus_claims WHERE updated_at<NOW()-INTERVAL '180 days'`;
}

export type DailyBonusTestSendStatus =
  'queued' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'expired';

export interface DailyBonusTestSendRow {
  id: string;
  guild_id: string;
  channel_id: string;
  target_date: string;
  requested_by: string;
  status: DailyBonusTestSendStatus;
  message_id: string | null;
  error_code: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export type DailyBonusTestSendDbClient = PrismaClient | Prisma.TransactionClient;

/**
 * TEST send requests (#766 Phase D1 / #723). Studio creates the row,
 * the Bot claims and sends it. The rate-limit inputs (an in-flight
 * request, the latest request time) are read by the caller so the
 * policy stays visible in the Studio route.
 */
export async function createDailyBonusTestSend(
  db: DailyBonusTestSendDbClient,
  input: {
    id: string;
    guildId: string;
    channelId: string;
    targetDate: string;
    requestedBy: string;
    expiresAt: Date;
  },
): Promise<DailyBonusTestSendRow> {
  const rows = await db.$queryRaw<DailyBonusTestSendRow[]>`
    INSERT INTO daily_bonus_test_sends
      (id, guild_id, channel_id, target_date, requested_by, status, expires_at)
    VALUES (${input.id}, ${input.guildId}, ${input.channelId}, ${input.targetDate},
      ${input.requestedBy}, 'queued', ${input.expiresAt})
    RETURNING id, guild_id, channel_id, target_date, requested_by, status, message_id, error_code, expires_at, created_at, updated_at`;
  return rows[0]!;
}

export async function listDailyBonusTestSends(
  db: DailyBonusTestSendDbClient,
  guildId: string,
  limit = 10,
): Promise<DailyBonusTestSendRow[]> {
  return db.$queryRaw<DailyBonusTestSendRow[]>`
    SELECT id, guild_id, channel_id, target_date, requested_by, status, message_id, error_code, expires_at, created_at, updated_at FROM daily_bonus_test_sends
    WHERE guild_id = ${guildId}
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 50)}`;
}

export async function countInFlightDailyBonusTestSends(
  db: DailyBonusTestSendDbClient,
  guildId: string,
): Promise<number> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM daily_bonus_test_sends
    WHERE guild_id = ${guildId} AND status IN ('queued', 'sending')`;
  return rows[0]?.count ?? 0;
}

export async function getLatestDailyBonusTestSend(
  db: DailyBonusTestSendDbClient,
  guildId: string,
): Promise<DailyBonusTestSendRow | null> {
  const rows = await listDailyBonusTestSends(db, guildId, 1);
  return rows[0] ?? null;
}

/**
 * Claim the oldest live request for the guild. Expired queued rows are
 * marked expired in the same statement so they can never be sent late.
 * A row stuck in 'sending' for over two minutes (interrupted Bot) is
 * closed as 'uncertain' rather than resent: the delivery outcome is
 * unknown and test sends are never blindly repeated (#723).
 */
export async function claimNextDailyBonusTestSend(
  db: DailyBonusTestSendDbClient,
  guildId: string,
): Promise<DailyBonusTestSendRow | null> {
  await db.$executeRaw`
    UPDATE daily_bonus_test_sends SET status = 'expired', updated_at = NOW()
    WHERE guild_id = ${guildId} AND status = 'queued' AND expires_at <= NOW()`;
  await db.$executeRaw`
    UPDATE daily_bonus_test_sends SET status = 'uncertain',
      error_code = 'InterruptedSendRequiresReview', updated_at = NOW()
    WHERE guild_id = ${guildId} AND status = 'sending'
      AND updated_at < NOW() - INTERVAL '2 minutes'`;
  const rows = await db.$queryRaw<DailyBonusTestSendRow[]>`
    UPDATE daily_bonus_test_sends SET status = 'sending', updated_at = NOW()
    WHERE id = (
      SELECT id FROM daily_bonus_test_sends
      WHERE guild_id = ${guildId} AND status = 'queued' AND expires_at > NOW()
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING id, guild_id, channel_id, target_date, requested_by, status, message_id, error_code, expires_at, created_at, updated_at`;
  return rows[0] ?? null;
}

export async function completeDailyBonusTestSend(
  db: DailyBonusTestSendDbClient,
  id: string,
  outcome: 'sent' | 'failed' | 'uncertain',
  messageId: string | null,
  errorCode: string | null,
): Promise<boolean> {
  const count = await db.$executeRaw`
    UPDATE daily_bonus_test_sends
    SET status = ${outcome}, message_id = ${messageId}, error_code = ${errorCode},
      updated_at = NOW()
    WHERE id = ${id} AND status = 'sending'`;
  return count === 1;
}
