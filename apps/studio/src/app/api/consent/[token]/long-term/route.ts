import { NextResponse } from 'next/server';
import {
  resolveVoiceConsentAccess,
  updateVcRecapLongTermConsentChoices,
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
    typeof payload['transcription'] !== 'boolean' ||
    typeof payload['transcriptLongTerm'] !== 'boolean' ||
    typeof payload['audioLongTerm'] !== 'boolean'
  ) {
    return json({ error: 'ポリシー版または同意選択が正しくありません' }, 400);
  }
  const result = await updateVcRecapLongTermConsentChoices(prisma, access.userId, {
    transcription: payload['transcription'],
    transcriptLongTerm: payload['transcriptLongTerm'],
    audioLongTerm: payload['audioLongTerm'],
  });

  switch (result) {
    case 'updated':
      return json({ ok: true, result });
    case 'erasure_requested':
      return json({ ok: true, result });
    case 'invalid':
      return json({ error: '本文の長期保存には文字起こし処理への同意が必要です' }, 400);
    case 'enrollment_disabled':
      return json({ error: '長期保存の同意受付はまだ開始していません' }, 409);
    case 'legacy_consent_required':
      return json({ error: '現在の30日版文字起こし同意を先に設定してください' }, 409);
    case 'erasure_pending':
      return json({ error: '削除依頼が登録されているため同意を変更できません' }, 409);
  }
}
