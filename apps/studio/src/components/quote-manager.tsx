'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface QuoteManagerItem {
  quoteNumber: number;
  quoteText: string;
  sourceAuthorName: string | null;
  registeredByName: string;
  tags: string[];
  status: string;
  isNsfw: boolean;
  createdAt: string;
}

export function QuoteManager({
  guildId,
  items,
}: {
  guildId: string;
  items: QuoteManagerItem[];
}) {
  const router = useRouter();
  const [quoteText, setQuoteText] = useState('');
  const [sourceAuthorName, setSourceAuthorName] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('public');
  const [isNsfw, setIsNsfw] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function createQuote() {
    setBusy(true);
    setMessage('登録中…');
    try {
      await apiRequest(`/api/guilds/${guildId}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteText,
          sourceAuthorName,
          tags,
          status,
          isNsfw,
        }),
      });
      setQuoteText('');
      setSourceAuthorName('');
      setTags('');
      setStatus('public');
      setIsNsfw(false);
      setMessage('Quoteを登録しました');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登録に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <div>
          <h2 className="text-lg font-semibold">新しいQuote</h2>
          <p className="mt-1 text-sm text-muted">Dashboardから登録した操作は監査ログへ記録されます。</p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="text-sm font-medium">名言本文</span>
            <textarea
              value={quoteText}
              onChange={(event) => setQuoteText(event.target.value)}
              rows={4}
              maxLength={1800}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="残しておきたい発言や名言を入力"
            />
          </label>
          <label>
            <span className="text-sm font-medium">作者・発言者</span>
            <input
              value={sourceAuthorName}
              onChange={(event) => setSourceAuthorName(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="任意"
            />
          </label>
          <label>
            <span className="text-sm font-medium">タグ</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="herta, bot"
            />
          </label>
          <label>
            <span className="text-sm font-medium">ステータス</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="public">public</option>
              <option value="private">private</option>
              <option value="hidden">hidden</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end rounded-xl border border-border bg-background px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={isNsfw}
              onChange={(event) => setIsNsfw(event.target.checked)}
            />
            NSFWとして扱う
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            {message}
          </p>
          <button
            type="button"
            onClick={createQuote}
            disabled={busy || !quoteText.trim()}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Quoteを登録
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">登録済みQuote</h2>
        {items.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
            条件に一致するQuoteはありません。
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {items.map((item) => (
              <QuoteEditor key={item.quoteNumber} guildId={guildId} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function QuoteEditor({ guildId, item }: { guildId: string; item: QuoteManagerItem }) {
  const router = useRouter();
  const [quoteText, setQuoteText] = useState(item.quoteText);
  const [sourceAuthorName, setSourceAuthorName] = useState(item.sourceAuthorName ?? '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const [status, setStatus] = useState(item.status);
  const [isNsfw, setIsNsfw] = useState(item.isNsfw);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveQuote() {
    setBusy(true);
    setMessage('保存中…');
    try {
      await apiRequest(`/api/guilds/${guildId}/quotes/${item.quoteNumber}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteText, sourceAuthorName, tags, status, isNsfw }),
      });
      setMessage('保存しました');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function removeQuote() {
    if (!window.confirm(`Quote #${item.quoteNumber} を削除しますか？`)) return;
    setBusy(true);
    setMessage('削除中…');
    try {
      await apiRequest(`/api/guilds/${guildId}/quotes/${item.quoteNumber}`, {
        method: 'DELETE',
      });
      setMessage('削除しました');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '削除に失敗しました');
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Quote #{item.quoteNumber}</h3>
          <p className="mt-1 text-xs text-muted">
            登録者: {item.registeredByName} · {new Date(item.createdAt).toLocaleString('ja-JP')}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full border border-border px-2 py-1">{status}</span>
          {isNsfw ? <span className="rounded-full border border-border px-2 py-1">NSFW</span> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="md:col-span-2">
          <span className="sr-only">Quote #{item.quoteNumber} 本文</span>
          <textarea
            value={quoteText}
            onChange={(event) => setQuoteText(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <input
          value={sourceAuthorName}
          onChange={(event) => setSourceAuthorName(event.target.value)}
          aria-label={`Quote #${item.quoteNumber} 作者`}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="作者・発言者"
        />
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          aria-label={`Quote #${item.quoteNumber} タグ`}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="タグ"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label={`Quote #${item.quoteNumber} ステータス`}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="public">public</option>
          <option value="private">private</option>
          <option value="hidden">hidden</option>
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={isNsfw}
            onChange={(event) => setIsNsfw(event.target.checked)}
          />
          NSFW
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {message}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={removeQuote}
            disabled={busy}
            className="rounded-xl border border-red-500/40 px-3 py-2 text-sm font-medium text-red-500 disabled:opacity-50"
          >
            削除
          </button>
          <button
            type="button"
            onClick={saveQuote}
            disabled={busy || !quoteText.trim()}
            className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </article>
  );
}

async function apiRequest(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? '処理に失敗しました');
  return result;
}
