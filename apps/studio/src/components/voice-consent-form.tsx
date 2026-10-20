'use client';

import { useEffect, useState } from 'react';

export function VoiceConsentForm({
  token,
  initialConsent,
}: {
  token: string;
  initialConsent: boolean;
}) {
  const [consent, setConsent] = useState(initialConsent);
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
      setToast({
        message: next ? '✅ 同意に更新しました' : '🔒 未同意に更新しました',
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
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <p className="text-sm text-muted">現在の状態</p>
        <p className="mt-1 text-xl font-semibold">
          {consent ? (
            <span className="text-emerald-600 dark:text-emerald-400">同意済み</span>
          ) : (
            <span className="text-muted">未同意</span>
          )}
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || consent}
            onClick={() => submit(true)}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
          >
            同意する
          </button>
          <button
            type="button"
            disabled={busy || !consent}
            onClick={() => submit(false)}
            className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-background disabled:opacity-40"
          >
            同意しない
          </button>
        </div>
      </div>

      {toast ? (
        <div
          role="status"
          className={`fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[90vw] rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg transition-opacity ${
            toast.tone === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </>
  );
}
