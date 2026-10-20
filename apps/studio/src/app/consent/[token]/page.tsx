import type { Metadata } from 'next';
import Link from 'next/link';
import { Mic, ShieldCheck } from 'lucide-react';
import { getUserDataConsent, resolveVoiceConsentAccess } from '@herta/db';
import { VoiceConsentForm } from '@/components/voice-consent-form';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'VC発言の文字起こし同意 | Herta',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function VoiceConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await resolveVoiceConsentAccess(prisma, token);

  if (!access) {
    return (
      <AccessState
        title="リンクの有効期限が切れたか、無効になっています"
        detail="Discordで`/herta-privacy web-link`を実行して新しいURLを発行してください。"
      />
    );
  }

  const consent = await getUserDataConsent(prisma, access.userId);

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <section className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-7">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Mic className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Herta VC Recap
              </p>
              <h1 className="mt-1 text-lg font-semibold">VC発言の文字起こしへの同意</h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                同意すると、今後のVC Recap(<code className="text-foreground">/vc-recap start</code>
                )であなたの発言が要約生成の対象になります。いつでもこのページまたはDiscordの
                <code className="text-foreground">/herta-privacy voice-consent</code>
                から取り消せます。
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-xs leading-5 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            同意していない場合、発言は録音・文字起こしの対象になりません。収集するデータの範囲は
            <Link href="/privacy" className="ml-1 underline underline-offset-2">
              プライバシーポリシー
            </Link>
            をご確認ください。
          </div>
        </section>

        <VoiceConsentForm token={token} initialConsent={consent.voiceTranscriptionConsent} />
      </div>
    </main>
  );
}

function AccessState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-border bg-surface p-6 text-center shadow-card sm:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Mic className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{detail}</p>
      </section>
    </main>
  );
}
