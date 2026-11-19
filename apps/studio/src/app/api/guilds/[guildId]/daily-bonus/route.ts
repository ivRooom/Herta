import { NextResponse } from 'next/server';
import {
  deleteDailySpecialDayRule,
  listDailySpecialDayRules,
  saveDailySpecialDayRule,
} from '@herta/db';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parseSpecialDayRuleInput } from '@/lib/daily-bonus-admin-input';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasEffectivePluginPermission } from '@/lib/studio-plugin-permissions';
import { studioDailyBonusResource } from '@/lib/studio-policy-resources';
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
    !hasEffectivePluginPermission(
      resolved.access,
      'studio.settings.read',
      studioDailyBonusResource(guildId, 'history'),
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
    let specialDayRules: Awaited<ReturnType<typeof listDailySpecialDayRules>> = [];
    let specialDayRulesAvailable = true;
    try {
      specialDayRules = await listDailySpecialDayRules(prisma, allowed.guildId);
    } catch {
      specialDayRulesAvailable = false;
    }
    return reply({ announcements, specialDayRules, specialDayRulesAvailable });
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
    if (body.action === 'save-special-day-rule' || body.action === 'delete-special-day-rule') {
      if (
        !hasEffectivePluginPermission(
          allowed.policyAccess,
          'studio.settings.write',
          studioDailyBonusResource(allowed.guildId, 'special-days'),
        )
      )
        return reply({ error: 'forbidden' }, 403);
      if (body.action === 'save-special-day-rule') {
        const input = parseSpecialDayRuleInput(body.rule);
        if (!input) return reply({ error: 'invalid_request' }, 422);
        const saved = await saveDailySpecialDayRule(prisma, allowed.guildId, {
          id: input.id ?? crypto.randomUUID(),
          kind: input.kind,
          exactDate: input.exactDate,
          monthDay: input.monthDay,
          title: input.title,
          intro: input.intro,
          enabled: input.enabled,
          createdBy: allowed.actor,
        });
        if (!saved) return reply({ error: 'rule_not_found' }, 404);
        await prisma.auditLog.create({
          data: {
            guildId: allowed.guildId,
            actorId: allowed.actor,
            event: 'daily_bonus.special_day_rule.saved',
            metadata: {
              ruleId: saved.id,
              kind: saved.kind,
              exactDate: saved.exact_date,
              monthDay: saved.month_day,
              enabled: saved.enabled,
            },
          },
        });
        return reply({ status: 'saved', rule: saved });
      }
      if (typeof body.ruleId !== 'string' || body.ruleId.length === 0 || body.ruleId.length > 128)
        return reply({ error: 'invalid_request' }, 422);
      const deleted = await deleteDailySpecialDayRule(prisma, allowed.guildId, body.ruleId);
      if (!deleted) return reply({ error: 'rule_not_found' }, 404);
      await prisma.auditLog.create({
        data: {
          guildId: allowed.guildId,
          actorId: allowed.actor,
          event: 'daily_bonus.special_day_rule.deleted',
          metadata: { ruleId: body.ruleId },
        },
      });
      return reply({ status: 'deleted' });
    }
    const delivery = body.action === 'retry' || body.action === 'reconcile';
    if (!delivery) return reply({ error: 'invalid_request' }, 422);
    if (
      !hasEffectivePluginPermission(
        allowed.policyAccess,
        'studio.operation.execute',
        studioDailyBonusResource(allowed.guildId, 'delivery'),
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
    return reply({ error: 'invalid_request' }, 422);
  } catch {
    return reply({ error: 'invalid_or_unsafe_request' }, 422);
  }
}
