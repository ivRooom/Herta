'use client';

import { useEffect, useState } from 'react';

export function VoiceConsentForm({
  token,
  initialConsent,
  initialRetentionConsent,
}: {
  token: string;
  initialConsent: boolean;
  /** 本文の30日保存を説明する前に同意した人は、ここから同意し直せるようにする。 */
  initialRetentionConsent: boolean;
}) {
  const [consent, setConsent] = useState(initialConsent);
  const [retentionConsent, setRetentionConsent] = useState(initialRetentionConsent);
  const fullyConsented = consent && retentionConsent;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  async function submit(next: boolean) {
    setBusy(true);
    try {
      const response = await fetch(`/api/consent/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: next }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setToast({ message: payload?.error ?? '更新に失敗しました', tone: 'error' });
        return;
      }
      setConsent(next);
      setRetentionConsent(next);
      setToast({
        message: next ? '同意する に更新しました' : '同意しない に更新しました',
        tone: 'success',
      });
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="border border-border bg-surface">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <p className="text-xs font-medium text-muted">現在の設定</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight">
            {consent ? '同意する' : '同意しない'}
          </p>
          {consent && !retentionConsent ? (
            <p className="mt-1 text-xs text-muted">
              文字起こし本文の30日保存には未同意です。「同意する」で保存にも同意できます。
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:px-6">
          <button
            type="button"
            disabled={busy || fullyConsented}
            onClick={() => submit(true)}
            aria-pressed={fullyConsented}
            className="flex-1 border border-primary bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-40"
          >
            同意する
          </button>
          <button
            type="button"
            disabled={busy || !consent}
            onClick={() => submit(false)}
            aria-pressed={!consent}
            className="flex-1 border border-border bg-background px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-40"
          >
            同意しない
          </button>
        </div>
      </section>

      {toast ? (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-6 z-50 mx-auto w-fit max-w-[calc(100vw-2rem)] border px-4 py-3 text-sm font-medium shadow-lg ${
            toast.tone === 'success'
              ? 'border-foreground bg-foreground text-background'
              : 'border-destructive bg-destructive text-white'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </>
  );
}
