import { NextResponse } from 'next/server';
import {
  resolveVoiceConsentAccess,
  updateVcRecapComprehensiveConsent,
  VC_RECAP_LONG_TERM_CONSENT_VERSION,
} from '@herta/db';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOriginMutationRequest(request)) {
    return json({ error: '不正な送信元からのリクエストです' }, 403);
  }
  const { token } = await params;
  const access = await resolveVoiceConsentAccess(prisma, token);
  if (!access) return json({ error: 'リンクの有効期限が切れたか、無効になっています' }, 410);

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'リクエストが正しくありません' }, 400);
  }
  const payload = body as Record<string, unknown>;
  if (
    payload['policyVersion'] !== VC_RECAP_LONG_TERM_CONSENT_VERSION ||
    typeof payload['accepted'] !== 'boolean' ||
    Object.keys(payload).some((key) => !['policyVersion', 'accepted'].includes(key))
  ) {
    return json({ error: 'ポリシー版または包括同意が正しくありません' }, 400);
  }
  const result = await updateVcRecapComprehensiveConsent(
    prisma,
    access.userId,
    payload['accepted'],
  );

  switch (result) {
    case 'updated':
      return json({ ok: true, result });
    case 'erasure_requested':
      return json({ ok: true, result });
    case 'invalid':
      return json({ error: '包括同意の指定が正しくありません' }, 400);
    case 'enrollment_disabled':
      return json({ error: '長期保存の同意受付はまだ開始していません' }, 409);
    case 'erasure_pending':
      return json({ error: '削除依頼が登録されているため同意を変更できません' }, 409);
  }
}
