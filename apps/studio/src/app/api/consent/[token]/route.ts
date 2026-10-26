import { NextResponse } from 'next/server';
import { resolveVoiceConsentAccess, setVoiceTranscriptionConsent } from '@herta/db';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOriginMutationRequest(request)) {
    return json({ error: '不正な送信元からのリクエストです' }, 403);
  }

  const { token } = await params;
  const access = await resolveVoiceConsentAccess(prisma, token);
  if (!access) {
    return json({ error: 'リンクの有効期限が切れたか、無効になっています' }, 410);
  }

  const body = await request.json().catch(() => null);
  const consent =
    body && typeof body === 'object' ? (body as Record<string, unknown>).consent : undefined;
  if (typeof consent !== 'boolean') {
    return json({ error: 'リクエストが正しくありません' }, 400);
  }

  // 同意ページで本文の30日保存を説明しているため、同意は本文保存への同意も兼ねる。
  await setVoiceTranscriptionConsent(prisma, access.userId, consent, { transcriptRetention: true });
  return json({ ok: true, consent });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}
