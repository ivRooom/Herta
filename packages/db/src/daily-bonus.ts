import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export interface DailyAnnouncement {
  updated_at: Date;
  guild_id: string;
  target_date: string;
  channel_id: string;
  role_id: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'disabled';
  message_id: string | null;
  error_code: string | null;
}
export interface AnniversaryEvent {
  id: string;
  title: string;
  summary: string;
  category: string;
  month: number;
  day: number;
  base_year: number | null;
  work_name: string;
  character_name: string;
  source_url: string;
  source_checked_at: Date;
  approved: boolean;
  public: boolean;
  priority: number;
  pinned_date: string | null;
  anniversary_mode: 'annual' | 'elapsed';
}
export async function saveDailyAnniversary(
  db: Pick<PrismaClient, '$executeRaw'>,
  guild: string,
  event: AnniversaryEvent,
) {
  const count =
    await db.$executeRaw`INSERT INTO anniversary_events(id,guild_id,title,summary,category,month,day,base_year,work_name,character_name,source_url,source_checked_at,approved,public,priority,pinned_date,anniversary_mode) VALUES(${event.id},${guild},${event.title},${event.summary},${event.category},${event.month},${event.day},${event.base_year},${event.work_name},${event.character_name},${event.source_url},${event.source_checked_at},${event.approved},${event.public},${event.priority},${event.pinned_date},${event.anniversary_mode}) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,category=EXCLUDED.category,month=EXCLUDED.month,day=EXCLUDED.day,base_year=EXCLUDED.base_year,work_name=EXCLUDED.work_name,character_name=EXCLUDED.character_name,source_url=EXCLUDED.source_url,source_checked_at=EXCLUDED.source_checked_at,approved=EXCLUDED.approved,public=EXCLUDED.public,priority=EXCLUDED.priority,pinned_date=EXCLUDED.pinned_date,anniversary_mode=EXCLUDED.anniversary_mode,updated_at=NOW() WHERE anniversary_events.guild_id=EXCLUDED.guild_id`;
  if (count !== 1) throw new Error('AnniversaryGuildConflict');
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
  >`UPDATE daily_bonus_announcements SET status='sending',channel_id=${channel},role_id=${role},updated_at=NOW() WHERE guild_id=${guild} AND target_date=${date} AND status='pending' AND message_id IS NULL RETURNING *`;
  return rows[0] ?? null;
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
export async function listAnniversaries(db: PrismaClient, guild: string) {
  return db.$queryRaw<
    AnniversaryEvent[]
  >`SELECT * FROM anniversary_events WHERE guild_id=${guild} ORDER BY priority DESC,title LIMIT 1000`;
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
