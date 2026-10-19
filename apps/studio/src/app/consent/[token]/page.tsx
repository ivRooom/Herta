import type { Metadata } from 'next';
import { getUserDataConsent, resolveVoiceConsentAccess } from '@herta/db';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'VC発言の文字起こし同意 | Herta',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function VoiceConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const access = await resolveVoiceConsentAccess(prisma, token);

  if (!access) {
    return (
      <main style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
        <h1>リンクの有効期限が切れたか、無効になっています</h1>
        <p>Discordで`/herta-privacy web-link`を実行して新しいURLを発行してください。</p>
      </main>
    );
  }

  const consent = await getUserDataConsent(prisma, access.userId);

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1>VC発言の文字起こしへの同意</h1>
      {query.updated === '1' ? <p>✅ 設定を更新しました。</p> : null}
      <p>
        現在の状態: <strong>{consent.voiceTranscriptionConsent ? '同意済み' : '未同意'}</strong>
      </p>
      <p>
        同意すると、今後のVC Recap(`/vc-recap start`)であなたの発言が要約生成の対象になります。
        いつでもこのページまたはDiscordの`/herta-privacy voice-consent`から取り消せます。
      </p>
      <form action={`/api/consent/${token}`} method="post" style={{ display: 'inline' }}>
        <input type="hidden" name="consent" value="true" />
        <button type="submit" style={{ marginRight: 12 }}>
          同意する
        </button>
      </form>
      <form action={`/api/consent/${token}`} method="post" style={{ display: 'inline' }}>
        <input type="hidden" name="consent" value="false" />
        <button type="submit">同意しない</button>
      </form>
    </main>
  );
}
