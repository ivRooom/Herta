import { NextResponse } from 'next/server';
import { saveDailyAnniversary } from '@herta/db';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasEffectivePluginPermission } from '@/lib/studio-plugin-permissions';
import { studioDailyBonusResource } from '@/lib/studio-policy-resources';
import { validDailyBonusDate } from '@/lib/daily-bonus-admin-input';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { readRequestBodyBytes } from '@/lib/bounded-request-body';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ guildId: string }> };
const reply = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function access(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return { response: reply({ error: 'unauthorized' }, 401) };
  const { guildId } = await context.params;
  const resolved = await resolveStudioAccess(guildId, session.user.id);
  if (!resolved.ok) return { response: resolved.response };
  if (
    request.method === 'GET' &&
    !(['history', 'anniversaries'] as const).every((resource) =>
      hasEffectivePluginPermission(
        resolved.access,
        'studio.settings.read',
        studioDailyBonusResource(guildId, resource),
      ),
    )
  )
    return { response: reply({ error: 'forbidden' }, 403) };
  return { guildId, actor: session.user.id, policyAccess: resolved.access };
}
export async function GET(request: Request, context: Context) {
  const allowed = await access(request, context);
  if ('response' in allowed) return allowed.response;
  try {
    const announcements =
      await prisma.$queryRaw`SELECT a.*,COUNT(c.discord_user_id)::int AS claims,COUNT(c.discord_user_id) FILTER(WHERE c.status='confirmed')::int AS confirmed FROM daily_bonus_announcements a LEFT JOIN daily_bonus_claims c ON c.guild_id=a.guild_id AND c.target_date=a.target_date WHERE a.guild_id=${allowed.guildId} GROUP BY a.guild_id,a.target_date ORDER BY a.target_date DESC LIMIT 60`;
    const anniversaries =
      await prisma.$queryRaw`SELECT * FROM anniversary_events WHERE guild_id=${allowed.guildId} ORDER BY priority DESC,title LIMIT 1000`;
    return reply({ announcements, anniversaries });
  } catch {
    return reply({ error: 'daily_bonus_unavailable' }, 503);
  }
}
export async function POST(request: Request, context: Context) {
  if (!isSameOriginMutationRequest(request)) return reply({ error: 'forbidden' }, 403);
  const allowed = await access(request, context);
  if ('response' in allowed) return allowed.response;
  try {
    const bytes = await readRequestBodyBytes(request, 64000);
    const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const delivery = body.action === 'retry' || body.action === 'reconcile';
    if (
      !hasEffectivePluginPermission(
        allowed.policyAccess,
        delivery ? 'studio.operation.execute' : 'studio.settings.write',
        studioDailyBonusResource(allowed.guildId, delivery ? 'delivery' : 'anniversaries'),
      )
    )
      return reply({ error: 'forbidden' }, 403);
    if (body.action === 'reconcile' && typeof body.date === 'string') {
      const date = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
      if (body.date !== date) return reply({ error: 'date_mismatch' }, 409);
      await prisma.$transaction(async (tx) => {
        const count =
          await tx.$executeRaw`UPDATE daily_bonus_announcements SET error_code='ReconcileRequested',updated_at=NOW() WHERE guild_id=${allowed.guildId} AND target_date=${date} AND status='uncertain' AND message_id IS NULL`;
        if (count !== 1) throw new Error('UnsafeReconcile');
        await tx.auditLog.create({
          data: {
            guildId: allowed.guildId,
            actorId: allowed.actor,
            event: 'daily_bonus.reconcile.requested',
            metadata: { date },
          },
        });
      });
      return reply({ status: 'queued' });
    }
    if (
      body.action === 'retry' &&
      typeof body.date === 'string' &&
      /^\d{4}-\d\d-\d\d$/.test(body.date)
    ) {
      const date = new Date(Date.now() + 32400000).toISOString().slice(0, 10);
      if (body.date !== date) return reply({ error: 'date_mismatch' }, 409);
      await prisma.$transaction(async (tx) => {
        const count =
          await tx.$executeRaw`UPDATE daily_bonus_announcements SET status='pending',error_code=NULL,updated_at=NOW() WHERE guild_id=${allowed.guildId} AND target_date=${date} AND status='failed' AND message_id IS NULL`;
        if (count !== 1) throw new Error('UnsafeRetry');
        await tx.auditLog.create({
          data: {
            guildId: allowed.guildId,
            actorId: allowed.actor,
            event: 'daily_bonus.retry',
            metadata: { date },
          },
        });
      });
      return reply({ status: 'queued' });
    }
    if (body.action === 'save-anniversary') {
      const e = body.event as Record<string, unknown>;
      if (
        !e ||
        typeof e.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(e.id) ||
        typeof e.title !== 'string' ||
        !e.title.trim() ||
        e.title.length > 150 ||
        typeof e.summary !== 'string' ||
        e.summary.length > 500 ||
        !['character', 'game', 'anime', 'manga', 'general', 'community'].includes(
          String(e.category),
        ) ||
        !Number.isInteger(e.month) ||
        !Number.isInteger(e.day) ||
        typeof e.sourceUrl !== 'string' ||
        e.sourceUrl.length > 400
      )
        throw new Error('InvalidEvent');
      const month = Number(e.month),
        day = Number(e.day),
        year = e.baseYear === null ? null : Number(e.baseYear);
      const d = new Date(Date.UTC(2000, month - 1, day));
      const url = new URL(e.sourceUrl);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        d.getUTCMonth() + 1 !== month ||
        d.getUTCDate() !== day ||
        !Number.isSafeInteger(e.priority) ||
        Math.abs(Number(e.priority)) > 1000 ||
        !(year === null || (Number.isInteger(year) && year >= 1800 && year <= 9999)) ||
        typeof e.approved !== 'boolean' ||
        typeof e.public !== 'boolean' ||
        !['annual', 'elapsed'].includes(String(e.anniversaryMode))
      )
        throw new Error('InvalidEvent');
      const checked = new Date(String(e.sourceCheckedAt));
      if (!Number.isFinite(checked.getTime()) || checked.getTime() > Date.now())
        throw new Error('InvalidEvent');
      const pinned = e.pinnedDate === null ? null : String(e.pinnedDate);
      if (pinned && !validDailyBonusDate(pinned)) throw new Error('InvalidEvent');
      const work = typeof e.workName === 'string' ? e.workName.slice(0, 200) : '',
        character = typeof e.characterName === 'string' ? e.characterName.slice(0, 200) : '';
      await prisma.$transaction(async (tx) => {
        const existing = await tx.$queryRaw<
          Array<{ guild_id: string }>
        >`SELECT guild_id FROM anniversary_events WHERE id=${e.id as string}`;
        if (existing[0] && existing[0].guild_id !== allowed.guildId)
          throw new Error('InvalidEvent');
        await saveDailyAnniversary(tx, allowed.guildId, {
          id: e.id as string,
          title: e.title as string,
          summary: e.summary as string,
          category: String(e.category),
          month,
          day,
          base_year: year,
          work_name: work,
          character_name: character,
          source_url: url.href,
          source_checked_at: checked,
          approved: e.approved as boolean,
          public: e.public as boolean,
          priority: Number(e.priority),
          pinned_date: pinned,
          anniversary_mode: String(e.anniversaryMode) as 'annual' | 'elapsed',
        });
        await tx.auditLog.create({
          data: {
            guildId: allowed.guildId,
            actorId: allowed.actor,
            event: 'daily_bonus.anniversary.saved',
            targetId: e.id as string,
            metadata: { approved: e.approved as boolean, public: e.public as boolean },
          },
        });
      });
      return reply({ status: 'saved' });
    }
    return reply({ error: 'invalid_request' }, 422);
  } catch {
    return reply({ error: 'invalid_or_unsafe_request' }, 422);
  }
}
