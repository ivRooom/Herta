'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Save, ShieldCheck } from 'lucide-react';

type Provider = 'openai';
type ModelProfile = 'quality' | 'balanced' | 'economy';
type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type RuntimeValue = {
  provider: Provider;
  modelProfile: ModelProfile;
  reasoningEffort: ReasoningEffort;
};

type PolicyProfile = {
  modelProfile: ModelProfile;
  model: string;
  supportedReasoningEfforts: ReasoningEffort[];
  pricing: {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    reviewAfterIso: string | null;
  };
};

type PolicyProvider = {
  provider: Provider;
  profiles: PolicyProfile[];
};

type RuntimeResponse = {
  current: RuntimeValue;
  resolved: RuntimeValue & {
    model: string;
    pricing: PolicyProfile['pricing'];
  };
  source: 'console' | 'environment' | 'default';
  storeAvailable: boolean;
  updatedAt: string | null;
  policy: PolicyProvider[];
};

type LoadState = 'loading' | 'ready' | 'hidden' | 'error';

const ENDPOINT = '/api/admin/runtime-config/ai';

export function AiRuntimeSettings() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [provider, setProvider] = useState<Provider>('openai');
  const [modelProfile, setModelProfile] = useState<ModelProfile>('balanced');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('low');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const applyResponse = useCallback((next: RuntimeResponse) => {
    setRuntime(next);
    setProvider(next.current.provider);
    setModelProfile(next.current.modelProfile);
    setReasoningEffort(next.current.reasoningEffort);
  }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    setMessage(null);
    try {
      const response = await fetch(ENDPOINT, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (response.status === 401 || response.status === 403) {
        setRuntime(null);
        setLoadState('hidden');
        return;
      }
      if (!response.ok) throw new Error('runtime settings request failed');
      const body = (await response.json()) as unknown;
      if (!isRuntimeResponse(body)) throw new Error('invalid runtime settings response');
      applyResponse(body);
      setLoadState('ready');
    } catch {
      setRuntime(null);
      setLoadState('error');
    }
  }, [applyResponse]);

  useEffect(() => {
    void load();
  }, [load]);

  const providerPolicy = useMemo(
    () => runtime?.policy.find((entry) => entry.provider === provider) ?? null,
    [provider, runtime],
  );
  const profilePolicy = useMemo(
    () => providerPolicy?.profiles.find((entry) => entry.modelProfile === modelProfile) ?? null,
    [modelProfile, providerPolicy],
  );
  const canSave = Boolean(
    runtime &&
    profilePolicy &&
    reasoningEffort &&
    profilePolicy.supportedReasoningEfforts.includes(reasoningEffort) &&
    !saving,
  );

  const selectProvider = (nextProvider: Provider) => {
    setProvider(nextProvider);
    setMessage(null);
    const nextPolicy = runtime?.policy.find((entry) => entry.provider === nextProvider);
    if (!nextPolicy?.profiles.some((entry) => entry.modelProfile === modelProfile)) {
      setModelProfile(nextPolicy?.profiles[0]?.modelProfile ?? 'balanced');
    }
  };

  const selectProfile = (nextProfile: ModelProfile) => {
    setModelProfile(nextProfile);
    setMessage(null);
    const nextPolicy = providerPolicy?.profiles.find((entry) => entry.modelProfile === nextProfile);
    if (!nextPolicy?.supportedReasoningEfforts.includes(reasoningEffort as ReasoningEffort)) {
      setReasoningEffort('');
    }
  };

  const save = async () => {
    if (!canSave || !reasoningEffort) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, modelProfile, reasoningEffort }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        setMessage(readError(body, 'AI Runtime Settingsを保存できませんでした'));
        return;
      }
      if (!isRuntimeResponse(body)) {
        setMessage('保存結果を確認できませんでした');
        return;
      }
      applyResponse(body);
      setMessage('AI Runtime Settingsを保存しました。Botはbounded stale内で新設定へ収束します。');
    } catch {
      setMessage('AI Runtime Settingsを保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  if (loadState === 'loading' || loadState === 'hidden') return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <BrainCircuit className="h-4 w-4" aria-hidden="true" />
            AI Runtime Settings
          </div>
          <h2 className="mt-2 text-lg font-semibold">Provider / Model / Reasoning</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Herta全体の生成AI runtime policyを変更します。API keyはここでは扱わず、Provider
            Credentialsで別管理します。
          </p>
        </div>
        {runtime ? (
          <span className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-muted">
            {sourceLabel(runtime.source)}
          </span>
        ) : null}
      </div>

      {loadState === 'error' ? (
        <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-700 dark:text-red-300">
            AI Runtime Settingsを読み込めませんでした。
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            再読み込み
          </button>
        </div>
      ) : runtime ? (
        <>
          {!runtime.storeAvailable ? (
            <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-5 text-amber-800 dark:text-amber-200">
              Runtime Configuration Storeを読めないため、現在はallowlisted env / safe
              defaultを使用しています。保存操作の前にDB状態を確認してください。
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <label className="text-sm font-medium">
              Provider
              <select
                value={provider}
                onChange={(event) => selectProvider(event.target.value as Provider)}
                disabled={saving}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              >
                {runtime.policy.map((entry) => (
                  <option key={entry.provider} value={entry.provider}>
                    {providerLabel(entry.provider)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium">
              Model profile
              <select
                value={modelProfile}
                onChange={(event) => selectProfile(event.target.value as ModelProfile)}
                disabled={saving}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              >
                {providerPolicy?.profiles.map((profile) => (
                  <option key={profile.modelProfile} value={profile.modelProfile}>
                    {profile.modelProfile} — {profile.model}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium">
              Reasoning
              <select
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                disabled={saving}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              >
                {!reasoningEffort ? <option value="">選択してください</option> : null}
                {profilePolicy?.supportedReasoningEfforts.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {profilePolicy ? (
            <div className="mt-4 rounded-xl border border-border bg-background p-4 text-xs leading-5 text-muted">
              <p>
                Resolved model: <strong className="text-foreground">{profilePolicy.model}</strong>
              </p>
              <p className="mt-1">
                Standard token price: input ${profilePolicy.pricing.inputUsdPerMillion.toFixed(2)} /
                1M · output ${profilePolicy.pricing.outputUsdPerMillion.toFixed(2)} / 1M
              </p>
              {profilePolicy.pricing.reviewAfterIso ? (
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  Pricing review deadline: {formatDateTime(profilePolicy.pricing.reviewAfterIso)}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-xs leading-5 text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p>
                Provider / model / reasoning / pricingはserver-side policyがSource of
                Truthです。任意model IDや任意reasoning文字列は保存できません。
                {runtime.updatedAt ? ` 最終更新: ${formatDateTime(runtime.updatedAt)}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving ? '保存中…' : 'Runtime設定を保存'}
            </button>
          </div>

          <p className="mt-3 min-h-5 text-xs text-muted" role="status" aria-live="polite">
            {message ?? ''}
          </p>
        </>
      ) : null}
    </section>
  );
}

function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  if (!isRecord(value) || !isRecord(value.current) || !isRecord(value.resolved)) return false;
  if (!Array.isArray(value.policy)) return false;
  return (
    value.current.provider === 'openai' &&
    typeof value.current.modelProfile === 'string' &&
    typeof value.current.reasoningEffort === 'string' &&
    typeof value.resolved.model === 'string' &&
    (value.source === 'console' || value.source === 'environment' || value.source === 'default') &&
    typeof value.storeAvailable === 'boolean' &&
    (value.updatedAt === null || typeof value.updatedAt === 'string')
  );
}

function sourceLabel(source: RuntimeResponse['source']): string {
  if (source === 'console') return 'Console override';
  if (source === 'environment') return 'Environment default';
  return 'Safe default';
}

function providerLabel(provider: Provider): string {
  if (provider === 'openai') return 'OpenAI';
  return provider;
}

function readError(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string' ? value.error : fallback;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
