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
