'use client';

import { Check, Copy, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export function BirthdayRegistrationShare({ guildId }: { guildId: string }) {
  const relativeUrl = `/birthday/register/${guildId}`;
  const [shareUrl, setShareUrl] = useState(relativeUrl);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setShareUrl(new URL(relativeUrl, window.location.origin).toString());
  }, [relativeUrl]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setStatus('誕生日登録URLをコピーしました');
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setStatus('自動コピーできませんでした。URL欄から手動でコピーしてください');
    }
  }

  return (
    <section className="rounded-2xl border border-primary/20 bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Link2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Member向け誕生日登録URL</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            このURLをDiscordで共有すると、Memberロールを持つメンバーが自分の誕生日を直接登録できます。ログイン後もGuild所属とMemberロールをserver-sideで確認します。
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">誕生日登録URL</span>
          <input
            type="text"
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? 'コピー済み' : 'URLをコピー'}
        </button>
      </div>
      <p className="mt-2 min-h-5 text-xs text-muted" aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}
