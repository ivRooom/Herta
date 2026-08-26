'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Save, ShieldCheck, Trash2 } from 'lucide-react';

type CredentialStatus = {
  provider: 'openai';
  configured: boolean;
  environmentFallbackConfigured: boolean;
  updatedAt: string | null;
  keyVersion: number | null;
};

type LoadState = 'loading' | 'ready' | 'hidden' | 'error';

const CREDENTIAL_ENDPOINT = '/api/admin/runtime-secrets/openai';

export function AiProviderCredentialSettings() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    setMessage(null);
    try {
      const response = await fetch(CREDENTIAL_ENDPOINT, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (response.status === 401 || response.status === 403) {
        setStatus(null);
        setLoadState('hidden');
        return;
      }
      if (!response.ok) throw new Error('credential status request failed');
      const next = (await response.json()) as CredentialStatus;
      if (!isCredentialStatus(next)) throw new Error('invalid credential status');
      setStatus(next);
      setLoadState('ready');
    } catch {
      setStatus(null);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const nextApiKey = apiKey.trim();
    if (!nextApiKey || saving || deleting) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(CREDENTIAL_ENDPOINT, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: nextApiKey }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === 'string' ? body.error : 'APIキーを保存できませんでした');
        return;
      }
      if (!isCredentialStatus(body)) {
        setMessage('保存結果を確認できませんでした');
        return;
      }
      setStatus(body);
      setApiKey('');
      setMessage('OpenAI APIキーを安全に保存しました');
    } catch {
      setMessage('APIキーを保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!status?.configured || saving || deleting) return;
    const confirmation = status.environmentFallbackConfigured
      ? '保存済みのOpenAI APIキーを削除しますか？ OPENAI_API_KEY環境変数fallbackが引き続き使用されるため、AIアクセスは停止しません。'
      : '保存済みのOpenAI APIキーを削除しますか？ AI機能は利用できなくなります。';
    if (!window.confirm(confirmation)) return;

    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch(CREDENTIAL_ENDPOINT, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === 'string' ? body.error : 'APIキーを削除できませんでした');
        return;
      }
      if (!isCredentialStatus(body)) {
        setMessage('削除結果を確認できませんでした');
        return;
      }
      setStatus(body);
      setApiKey('');
      setMessage(
        body.environmentFallbackConfigured
          ? 'Console APIキーを削除しました。OPENAI_API_KEY環境変数fallbackは引き続き有効です。'
          : 'OpenAI APIキーを削除しました',
      );
    } catch {
      setMessage('APIキーを削除できませんでした');
    } finally {
      setDeleting(false);
    }
  };

  if (loadState === 'loading' || loadState === 'hidden') return null;

  const environmentFallbackActive = Boolean(
    status && !status.configured && status.environmentFallbackConfigured,
  );

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            AI Provider Credentials
          </div>
          <h2 className="mt-2 text-lg font-semibold">OpenAI APIキー</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Herta全体のAI機能とStudio Semantic Searchで使うserver-side
            credentialです。Herta管理者だけが変更できます。
          </p>
        </div>
        {loadState === 'ready' && status ? (
          <span
            className={`rounded-lg border px-2.5 py-1 text-xs ${
              status.configured
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : environmentFallbackActive
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-border bg-background text-muted'
            }`}
          >
            {status.configured
              ? 'Console設定済み'
              : environmentFallbackActive
                ? '環境変数fallback'
                : '未設定'}
          </span>
        ) : null}
      </div>

      {loadState === 'error' ? (
        <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-700 dark:text-red-300">
            Credential状態を読み込めませんでした。
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            再読み込み
          </button>
        </div>
      ) : status ? (
        <>
          {status.environmentFallbackConfigured ? (
            <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-5 text-amber-800 dark:text-amber-200">
              <strong>OPENAI_API_KEY環境変数fallbackが設定されています。</strong>{' '}
              {status.configured
                ? 'Console credentialを削除すると、このfallbackが再び使用されます。AIアクセスを完全に停止するにはproduction環境変数も削除してください。'
                : '現在はこのfallbackが使用されます。AIアクセスを完全に停止するにはproduction環境変数を削除してください。'}
            </div>
          ) : null}

          <div className="mt-5 rounded-xl border border-border bg-background p-4">
            <label htmlFor="openai-api-key" className="text-sm font-medium">
              新しいAPIキー
            </label>
            <p className="mt-1 text-xs leading-5 text-muted">
              保存済みキーは再表示しません。更新する場合だけ新しいキーを入力してください。
            </p>
            <input
              id="openai-api-key"
              name="openai-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={4096}
              placeholder={
                status.configured
                  ? '新しいキーを入力して置き換え'
                  : status.environmentFallbackConfigured
                    ? '環境変数fallbackを置き換えるキーを入力'
                    : 'OpenAI APIキーを入力'
              }
              disabled={saving || deleting}
              className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-xs leading-5 text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p>
                キーはAES-256-GCMで暗号化して保存し、ブラウザへ読み戻しません。raw
                keyをログやPlugin設定へ保存しません。
                {status.configured && status.updatedAt
                  ? ` 最終更新: ${formatDateTime(status.updatedAt)}`
                  : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {status.configured ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={saving || deleting}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-3 py-2.5 text-sm font-medium text-red-700 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {deleting ? '削除中…' : '削除'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void save()}
                disabled={!apiKey.trim() || saving || deleting}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? '保存中…' : status.configured ? 'APIキーを更新' : 'APIキーを保存'}
              </button>
            </div>
          </div>
          <p className="mt-3 min-h-5 text-xs text-muted" role="status" aria-live="polite">
            {message ?? ''}
          </p>
        </>
      ) : null}
    </section>
  );
}

function isCredentialStatus(value: unknown): value is CredentialStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.provider === 'openai' &&
    typeof record.configured === 'boolean' &&
    typeof record.environmentFallbackConfigured === 'boolean' &&
    (record.updatedAt === null || typeof record.updatedAt === 'string') &&
    (record.keyVersion === null || typeof record.keyVersion === 'number')
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
