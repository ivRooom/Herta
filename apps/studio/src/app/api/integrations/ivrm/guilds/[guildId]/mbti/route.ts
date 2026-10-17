import { NextResponse } from 'next/server';
import {
  getOrCreateMbtiWebQuizSession,
  getMbtiPersonalResult,
  issueMbtiResultAccess,
} from '@herta/db';
import { selectMbtiQuestions } from '@herta/shared/mbti-core';
import { authorizeIvrmIntegrationRequest } from '@/lib/ivrm-integration-auth';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { parseMemberMbtiLinkInput } from '@/lib/ivrm-mbti-link-input';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const auth = authorizeIvrmIntegrationRequest(request);
  if (auth.status !== 'authorized')
    return json({ error: auth.status }, auth.status === 'unconfigured' ? 503 : 401);
  const { guildId } = await params;
  if (guildId !== auth.config.guildId) return json({ error: 'not_found' }, 404);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return json({ error: 'invalid_content_type' }, 400);
  let input;
  try {
    input = parseMemberMbtiLinkInput(await readJsonBodyWithLimit(request, 1024));
  } catch (error) {
    return json({ error: 'invalid_body' }, error instanceof RequestBodyTooLargeError ? 413 : 400);
  }
  if (!input) return json({ error: 'invalid_input' }, 400);
  const subject = { guildId, discordUserId: input.discordUserId };
  try {
    if (input.action === 'result') {
      const latest = await getMbtiPersonalResult(prisma, subject);
      if (!latest) return json({ error: 'mbti_result_not_found' }, 404);
      const { token, expiresAt } = await issueMbtiResultAccess(
        prisma,
        guildId,
        input.discordUserId,
      );
      return json({
        path: `/mbti/history/${token}`,
        expiresAt: expiresAt.toISOString(),
        resultType: latest.resultType,
        resultIdentity: latest.resultIdentity,
      });
    }
    const plugin = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'mbti' } },
    });
    if (!plugin?.enabled || (plugin.config as Record<string, unknown> | null)?.enabled === false)
      return json({ error: 'mbti_disabled' }, 403);
    const session = await getOrCreateMbtiWebQuizSession(prisma, {
      ...subject,
      questions: selectMbtiQuestions(),
    });
    return json({
      path: `/mbti/${session.id}`,
      expiresAt: session.expiresAt.toISOString(),
      resumed: session.resumed,
    });
  } catch {
    return json({ error: 'mbti_service_unavailable' }, 503);
  }
}
