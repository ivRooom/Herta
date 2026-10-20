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

  const form = await request.formData().catch(() => null);
  const consentValue = form?.get('consent');
  if (consentValue !== 'true' && consentValue !== 'false') {
    return json({ error: 'リクエストが正しくありません' }, 400);
  }

  await setVoiceTranscriptionConsent(prisma, access.userId, consentValue === 'true');

  const redirectUrl = new URL(`/consent/${token}`, request.url);
  redirectUrl.searchParams.set('updated', '1');
  return NextResponse.redirect(redirectUrl, { status: 303, headers: RESPONSE_HEADERS });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}
