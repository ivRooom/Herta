import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasExplicitVcRecapExportPermission } from '@/lib/studio-policy-resources';
import {
  parseVcRecapExportFilters,
  serializeVcRecapCsv,
  toVcRecapExportObject,
  type VcRecapExportRecord,
} from '@/lib/vc-recap-export';

export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;
const MAX_EXPORT_ROWS = 5_000;
const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

type Context = { params: Promise<{ guildId: string }> };

/**
 * Export is deliberately more restricted than page.view: absent an explicit IAM
 * policy, non-root users cannot download voice transcript bodies.
 * This endpoint exports only the existing 30-day PostgreSQL data. It does not
 * advertise S3 archive coverage until the consent and deletion gates are complete.
 */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401, headers: NO_STORE });
  }

  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;
  if (!hasExplicitVcRecapExportPermission(access.access, guildId)) {
    return NextResponse.json(
      { error: '文字起こしの出力権限がありません' },
      { status: 403, headers: NO_STORE },
    );
  }

  const filters = parseVcRecapExportFilters(new URL(request.url).searchParams);
  if (!filters) {
    return NextResponse.json(
      {
        error: 'format=json|csv、sessionIds（最大50件）またはfrom/to（日付範囲）を指定してください',
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const rows = await prisma.vcRecapTranscriptSegment.findMany({
    where: {
      ...(filters.speakerId ? { userId: filters.speakerId } : {}),
      session: {
        guildId,
        endedAt: { not: null, gt: cutoff },
        ...(filters.sessionIds.length ? { id: { in: filters.sessionIds } } : {}),
        ...(filters.channelId ? { channelId: filters.channelId } : {}),
        ...(filters.from || filters.toExclusive
          ? {
              startedAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.toExclusive ? { lt: filters.toExclusive } : {}),
              },
            }
          : {}),
      },
    },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    take: MAX_EXPORT_ROWS + 1,
    select: {
      id: true,
      userId: true,
      text: true,
      startedAt: true,
      endedAt: true,
      session: {
        select: {
          id: true,
          guildId: true,
          channelId: true,
          startedAt: true,
          endedAt: true,
          summary: true,
          topics: true,
        },
      },
    },
  });
  if (rows.length > MAX_EXPORT_ROWS) {
    return NextResponse.json(
      { error: '出力上限5,000発言を超えました。日付・セッション・発言者で範囲を絞ってください' },
      { status: 413, headers: NO_STORE },
    );
  }

  // A historical segment never authorizes access by itself. Check that the
  // owner has not revoked the existing 30-day retention consent.
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const consents = userIds.length
    ? await prisma.userDataConsent.findMany({
        where: {
          userId: { in: userIds },
          voiceTranscriptionConsent: true,
          voiceTranscriptRetentionConsentedAt: { not: null },
        },
        select: { userId: true },
      })
    : [];
  const permitted = new Set(consents.map((entry) => entry.userId));
  const records: VcRecapExportRecord[] = rows
    .filter((row) => permitted.has(row.userId))
    .map((row) => ({
      sessionId: row.session.id,
      guildId: row.session.guildId,
      channelId: row.session.channelId,
      sessionStartedAt: row.session.startedAt,
      sessionEndedAt: row.session.endedAt,
      userId: row.userId,
      segmentId: row.id,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      text: row.text,
      summary: row.session.summary,
      topics: row.session.topics,
    }));

  // Audit before delivering any content; if persistence fails, fail closed.
  // Never place transcript, summary, or pre-signed URLs in audit metadata.
  await prisma.auditLog.create({
    data: {
      guildId,
      actorId: session.user.id,
      event: 'vc_recap.transcript_export',
      targetType: 'vc_recap_transcript',
      severity: 'info',
      metadata: {
        format: filters.format,
        resultCount: records.length,
        sessionCount: new Set(records.map((record) => record.sessionId)).size,
        filterBySpeaker: Boolean(filters.speakerId),
        filterByChannel: Boolean(filters.channelId),
      },
    },
  });

  const stamp = now.toISOString().slice(0, 10);
  if (filters.format === 'csv') {
    return new Response(serializeVcRecapCsv(records, now), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="vc-recap-${stamp}.csv"`,
      },
    });
  }
  return new Response(JSON.stringify(toVcRecapExportObject(records, now)), {
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="vc-recap-${stamp}.json"`,
    },
  });
}
