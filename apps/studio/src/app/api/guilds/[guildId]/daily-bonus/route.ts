import { NextResponse } from 'next/server';
import {
  activateDailyBonusTemplateRevision,
  approveDailyBonusTemplateRevision,
  createDailyBonusTemplateRevision,
  deactivateDailyBonusTemplateRevision,
  deleteDailyBonusTemplateRevision,
  deleteDailySpecialDayRule,
  getDailyBonusTemplateRevision,
  listDailyBonusTemplateRevisions,
  listDailySpecialDayRules,
  returnDailyBonusTemplateRevision,
  saveDailySpecialDayRule,
  submitDailyBonusTemplateRevision,
  updateDailyBonusTemplateRevisionDraft,
} from '@herta/db';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  parseSpecialDayRuleInput,
  parseTemplateRevisionContent,
  parseTemplateRevisionId,
  parseTemplateRevisionReviewNote,
} from '@/lib/daily-bonus-admin-input';
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
  const canReadHistory = hasEffectivePluginPermission(
    resolved.access,
    'studio.settings.read',
    studioDailyBonusResource(guildId, 'history'),
  );
  if (request.method === 'GET' && !canReadHistory) {
    // 特別日ルールや版管理の書き込み権限だけを持つ利用者も、管理に必要な一覧は読める。
    const canManageSpecialDays = hasEffectivePluginPermission(
      resolved.access,
      'studio.settings.write',
      studioDailyBonusResource(guildId, 'special-days'),
    );
    const canManageComposer = hasEffectivePluginPermission(
      resolved.access,
      'studio.settings.write',
      studioDailyBonusResource(guildId, 'composer'),
    );
    if (!canManageSpecialDays && !canManageComposer)
      return { response: reply({ error: 'forbidden' }, 403) };
  }
  return { guildId, actor: session.user.id, policyAccess: resolved.access, canReadHistory };
}
export async function GET(request: Request, context: Context) {
  const allowed = await access(request, context);
  if ('response' in allowed) return allowed.response;
  try {
    const announcements = allowed.canReadHistory
      ? await prisma.$queryRaw`SELECT a.*,COUNT(c.discord_user_id)::int AS claims,COUNT(c.discord_user_id) FILTER(WHERE c.status='confirmed')::int AS confirmed FROM daily_bonus_announcements a LEFT JOIN daily_bonus_claims c ON c.guild_id=a.guild_id AND c.target_date=a.target_date WHERE a.guild_id=${allowed.guildId} GROUP BY a.guild_id,a.target_date ORDER BY a.target_date DESC LIMIT 60`
      : [];
    let specialDayRules: Awaited<ReturnType<typeof listDailySpecialDayRules>> = [];
    let specialDayRulesAvailable = true;
    try {
      specialDayRules = await listDailySpecialDayRules(prisma, allowed.guildId);
    } catch {
      specialDayRulesAvailable = false;
    }
    let templateRevisions: Awaited<ReturnType<typeof listDailyBonusTemplateRevisions>> = [];
    let templateRevisionsAvailable = true;
    try {
      templateRevisions = await listDailyBonusTemplateRevisions(prisma, allowed.guildId);
    } catch {
      templateRevisionsAvailable = false;
    }
    return reply({
      announcements,
      specialDayRules,
      specialDayRulesAvailable,
      templateRevisions,
      templateRevisionsAvailable,
    });
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
        // ルール変更と監査記録は同一トランザクションで確定する（監査失敗時は変更も戻す）。
        const saved = await prisma.$transaction(async (tx) => {
          const row = await saveDailySpecialDayRule(tx, allowed.guildId, {
            id: input.id ?? crypto.randomUUID(),
            kind: input.kind,
            exactDate: input.exactDate,
            monthDay: input.monthDay,
            title: input.title,
            intro: input.intro,
            enabled: input.enabled,
            createdBy: allowed.actor,
          });
          if (!row) return null;
          await tx.auditLog.create({
            data: {
              guildId: allowed.guildId,
              actorId: allowed.actor,
              event: 'daily_bonus.special_day_rule.saved',
              metadata: {
                ruleId: row.id,
                kind: row.kind,
                exactDate: row.exact_date,
                monthDay: row.month_day,
                enabled: row.enabled,
              },
            },
          });
          return row;
        });
        if (!saved) return reply({ error: 'rule_not_found' }, 404);
        return reply({ status: 'saved', rule: saved });
      }
      if (typeof body.ruleId !== 'string' || body.ruleId.length === 0 || body.ruleId.length > 128)
        return reply({ error: 'invalid_request' }, 422);
      const ruleId = body.ruleId;
      const deleted = await prisma.$transaction(async (tx) => {
        const count = await deleteDailySpecialDayRule(tx, allowed.guildId, ruleId);
        if (count === 0) return 0;
        await tx.auditLog.create({
          data: {
            guildId: allowed.guildId,
            actorId: allowed.actor,
            event: 'daily_bonus.special_day_rule.deleted',
            metadata: { ruleId },
          },
        });
        return count;
      });
      if (deleted === 0) return reply({ error: 'rule_not_found' }, 404);
      return reply({ status: 'deleted' });
    }
    if (
      body.action === 'create-template-revision' ||
      body.action === 'update-template-revision' ||
      body.action === 'submit-template-revision' ||
      body.action === 'approve-template-revision' ||
      body.action === 'return-template-revision' ||
      body.action === 'activate-template-revision' ||
      body.action === 'deactivate-template-revision' ||
      body.action === 'delete-template-revision'
    ) {
      if (
        !hasEffectivePluginPermission(
          allowed.policyAccess,
          'studio.settings.write',
          studioDailyBonusResource(allowed.guildId, 'composer'),
        )
      )
        return reply({ error: 'forbidden' }, 403);
      const guildId = allowed.guildId;
      const actor = allowed.actor;
      if (body.action === 'create-template-revision') {
        const content = parseTemplateRevisionContent(body.messageTemplate);
        if (content === null) return reply({ error: 'invalid_request' }, 422);
        const created = await prisma.$transaction(async (tx) => {
          const row = await createDailyBonusTemplateRevision(tx, guildId, {
            id: crypto.randomUUID(),
            messageTemplate: content,
            createdBy: actor,
          });
          await tx.auditLog.create({
            data: {
              guildId,
              actorId: actor,
              event: 'daily_bonus.template_revision.created',
              metadata: { revisionId: row.id, revision: row.revision },
            },
          });
          return row;
        });
        return reply({ status: 'created', revision: created });
      }
      const revisionId = parseTemplateRevisionId(body.revisionId);
      if (revisionId === null) return reply({ error: 'invalid_request' }, 422);
      if (body.action === 'deactivate-template-revision') {
        const outcome = await prisma.$transaction(async (tx) => {
          const row = await getDailyBonusTemplateRevision(tx, guildId, revisionId);
          if (!row) return 'not_found' as const;
          if (row.status !== 'active') return 'conflict' as const;
          const count = await deactivateDailyBonusTemplateRevision(tx, guildId, revisionId);
          if (count !== 1) return 'conflict' as const;
          await tx.auditLog.create({
            data: {
              guildId,
              actorId: actor,
              event: 'daily_bonus.template_revision.deactivated',
              metadata: { revisionId: row.id, revision: row.revision },
            },
          });
          return 'ok' as const;
        });
        if (outcome === 'not_found') return reply({ error: 'revision_not_found' }, 404);
        if (outcome === 'conflict') return reply({ error: 'revision_conflict' }, 409);
        return reply({ status: 'deactivated' });
      }
      // 残りの操作は対象の版が存在することが前提。無い場合と自己承認を先に切り分ける。
      const existing = await getDailyBonusTemplateRevision(prisma, guildId, revisionId);
      if (!existing) return reply({ error: 'revision_not_found' }, 404);
      if (body.action === 'approve-template-revision' && existing.created_by === actor)
        return reply({ error: 'self_review_forbidden' }, 403);
      if (body.action === 'update-template-revision') {
        const content = parseTemplateRevisionContent(body.messageTemplate);
        if (content === null) return reply({ error: 'invalid_request' }, 422);
        const outcome = await prisma.$transaction(async (tx) => {
          const count = await updateDailyBonusTemplateRevisionDraft(
            tx,
            guildId,
            revisionId,
            content,
          );
          if (count !== 1) return 'conflict' as const;
          await tx.auditLog.create({
            data: {
              guildId,
              actorId: actor,
              event: 'daily_bonus.template_revision.updated',
              metadata: { revisionId, revision: existing.revision },
            },
          });
          return 'ok' as const;
        });
        if (outcome === 'conflict') return reply({ error: 'revision_conflict' }, 409);
        return reply({ status: 'updated' });
      }
      if (body.action === 'submit-template-revision') {
        const outcome = await prisma.$transaction(async (tx) => {
          const count = await submitDailyBonusTemplateRevision(tx, guildId, revisionId);
          if (count !== 1) return 'conflict' as const;
          await tx.auditLog.create({
            data: {
              guildId,
              actorId: actor,
              event: 'daily_bonus.template_revision.submitted',
              metadata: { revisionId, revision: existing.revision },
            },
          });
          return 'ok' as const;
        });
        if (outcome === 'conflict') return reply({ error: 'revision_conflict' }, 409);
        return reply({ status: 'submitted' });
      }
      if (body.action === 'approve-template-revision') {
        const outcome = await prisma.$transaction(async (tx) => {
          const count = await approveDailyBonusTemplateRevision(tx, guildId, revisionId, actor);
          if (count !== 1) return 'conflict' as const;
          await tx.auditLog.create({
            data: {
              guildId,
              actorId: actor,
              event: 'daily_bonus.template_revision.approved',
              metadata: { revisionId, revision: existing.revision },
            },
          });
          return 'ok' as const;
        });
        if (outcome === 'conflict') return reply({ error: 'revision_conflict' }, 409);
        return reply({ status: 'approved' });
      }
      if (body.action === 'return-template-revision') {
        const note = parseTemplateRevisionReviewNote(body.reviewNote);
        if (note === undefined) return reply({ error: 'invalid_request' }, 422);
        const outcome = await prisma.$transaction(async (tx) => {
          const count = await returnDailyBonusTemplateRevision(tx, guildId, revisionId, note);
          if (count !== 1) return 'conflict' as const;
          await tx.auditLog.create({
            data: {
              guildId,
              actorId: actor,
              event: 'daily_bonus.template_revision.returned',
              metadata: { revisionId, revision: existing.revision, reviewNote: note },
            },
          });
          return 'ok' as const;
        });
        if (outcome === 'conflict') return reply({ error: 'revision_conflict' }, 409);
        return reply({ status: 'returned' });
      }
      if (body.action === 'activate-template-revision') {
        const expectedRaw = body.expectedActiveRevisionId;
        const expected = expectedRaw === null ? null : parseTemplateRevisionId(expectedRaw);
        if (expectedRaw !== null && expected === null)
          return reply({ error: 'invalid_request' }, 422);
        try {
          await prisma.$transaction(async (tx) => {
            const result = await activateDailyBonusTemplateRevision(
              tx,
              guildId,
              revisionId,
              expected,
            );
            // 有効化できなかった場合は、旧 active の supersede ごと巻き戻す。
            if (result !== 'activated') throw new Error(`RevisionActivation:${result}`);
            await tx.auditLog.create({
              data: {
                guildId,
                actorId: actor,
                event: 'daily_bonus.template_revision.activated',
                metadata: {
                  revisionId,
                  revision: existing.revision,
                  previousActiveRevisionId: expected,
                },
              },
            });
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'RevisionActivation:conflict')
            return reply({ error: 'revision_conflict' }, 409);
          if (error instanceof Error && error.message === 'RevisionActivation:not_approved')
            return reply({ error: 'revision_not_approved' }, 409);
          throw error;
        }
        return reply({ status: 'activated' });
      }
      // delete-template-revision
      const outcome = await prisma.$transaction(async (tx) => {
        const count = await deleteDailyBonusTemplateRevision(tx, guildId, revisionId);
        if (count !== 1) return 'conflict' as const;
        await tx.auditLog.create({
          data: {
            guildId,
            actorId: actor,
            event: 'daily_bonus.template_revision.deleted',
            metadata: { revisionId, revision: existing.revision },
          },
        });
        return 'ok' as const;
      });
      if (outcome === 'conflict') return reply({ error: 'revision_conflict' }, 409);
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
