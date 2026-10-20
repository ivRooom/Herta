import type { Metadata } from 'next';
import Link from 'next/link';
import { getUserDataConsent, resolveVoiceConsentAccess } from '@herta/db';
import { VoiceConsentForm } from '@/components/voice-consent-form';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'VC発言の文字起こしに関する同意 | Herta',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function VoiceConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await resolveVoiceConsentAccess(prisma, token);

  if (!access) {
    return (
      <AccessState
        title="このリンクは期限切れ、または無効です"
        detail="Discordで「/herta-privacy web-link」を実行すると、新しいリンクを発行できます。"
      />
    );
  }

  const consent = await getUserDataConsent(prisma, access.userId);

  return (
    <PageShell>
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
        VC発言の文字起こしに関する同意
      </h1>
      <p className="mt-3 max-w-prose text-sm leading-7 text-muted">
        「同意する」にすると、今後のVC Recap(
        <code className="text-foreground">/vc-recap start</code>
        )で、あなたの発言が要約の作成対象になります。設定はいつでもこのページ、または Discordの
        <code className="text-foreground">/herta-privacy voice-consent</code>
        コマンドから変更できます。
      </p>

      <div className="mt-6 border-l-2 border-primary bg-surface px-4 py-3 text-sm leading-6 text-muted">
        同意していない場合、発言は録音・文字起こしの対象になりません。収集するデータの範囲は
        <Link href="/privacy" className="font-medium text-foreground underline underline-offset-2">
          プライバシーポリシー
        </Link>
        をご確認ください。
      </div>

      <div className="mt-8">
        <VoiceConsentForm token={token} initialConsent={consent.voiceTranscriptionConsent} />
      </div>
    </PageShell>
  );
}

function AccessState({ title, detail }: { title: string; detail: string }) {
  return (
    <PageShell>
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      <p className="mt-3 max-w-prose text-sm leading-7 text-muted">{detail}</p>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Herta</p>
      </div>
      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6 sm:py-14">{children}</div>
    </main>
  );
}
