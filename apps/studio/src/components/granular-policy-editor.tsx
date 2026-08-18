'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole, RotateCcw, Save, Search, ShieldCheck } from 'lucide-react';
import { describeStudioApiError } from '@/lib/studio-api-feedback';
import type { StudioAccessPolicy } from '@/lib/studio-access-policy';
import {
  getExplicitPermissionMode,
  setExplicitPermissionMode,
  type ExplicitPermissionMode,
} from '@/lib/studio-plugin-permissions';
import type { StudioGranularPermissionOption } from '@/lib/studio-policy-resources';

const MAX_POLICY_STATEMENTS = 64;
const SAVE_TIMEOUT_MS = 15_000;

interface GranularPolicyView {
  id: string;
  name: string;
  description: string | null;
  policy: StudioAccessPolicy;
  revision: number;
}

interface PolicyDraftState {
  policy: StudioAccessPolicy;
  revision: number;
  dirty: boolean;
}

export function GranularPolicyEditor({
  guildId,
  policies,
  options,
  canEdit,
}: {
  guildId: string;
  policies: GranularPolicyView[];
  options: StudioGranularPermissionOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selectedPolicyId, setSelectedPolicyId] = useState(policies[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, PolicyDraftState>>(() =>
    Object.fromEntries(
      policies.map((policy) => [
        policy.id,
        { policy: policy.policy, revision: policy.revision, dirty: false },
      ]),
    ),
  );
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) ?? null;
  const selectedDraft = selectedPolicy
    ? (drafts[selectedPolicy.id] ?? {
        policy: selectedPolicy.policy,
        revision: selectedPolicy.revision,
        dirty: false,
      })
    : null;
  const draft = selectedDraft?.policy ?? null;
  const dirty = selectedDraft?.dirty ?? false;
  const stale = Boolean(
    selectedPolicy && selectedDraft && selectedDraft.revision !== selectedPolicy.revision,
  );

  useEffect(() => {
    setDrafts((current) => {
      const validPolicyIds = new Set(policies.map((policy) => policy.id));
      const next = { ...current };
      let changed = false;

      for (const policy of policies) {
        const existing = current[policy.id];
        if (!existing || (!existing.dirty && existing.revision !== policy.revision)) {
          next[policy.id] = {
            policy: policy.policy,
            revision: policy.revision,
            dirty: false,
          };
          changed = true;
        }
      }

      for (const policyId of Object.keys(next)) {
        if (!validPolicyIds.has(policyId)) {
          delete next[policyId];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [policies]);

  const normalizedQuery = query.trim().toLocaleLowerCase('ja');
  const filteredOptions = useMemo(
    () =>
      options.filter((option) => {
        if (!normalizedQuery) return true;
        return [
          option.category,
          option.label,
          option.description,
          option.action,
          option.resource,
        ].some((value) => value.toLocaleLowerCase('ja').includes(normalizedQuery));
      }),
    [normalizedQuery, options],
  );
  const groupedOptions = useMemo(() => groupByCategory(filteredOptions), [filteredOptions]);

  function changeMode(option: StudioGranularPermissionOption, mode: ExplicitPermissionMode) {
    if (!selectedPolicy || !selectedDraft || !draft || !canEdit || pending || stale) return;
    const currentMode = getExplicitPermissionMode(draft, option.action, option.resource);
    if (
      currentMode === 'inherit' &&
      mode !== 'inherit' &&
      draft.Statement.length >= MAX_POLICY_STATEMENTS
    ) {
      setNotice({
        kind: 'error',
        text: `1つのPolicyは最大${MAX_POLICY_STATEMENTS} Statementです。権限セットを複数Policyへ分割してPrincipalへAttachしてください。`,
      });
      return;
    }

    const nextPolicy = setExplicitPermissionMode(draft, option.action, option.resource, mode);
    setDrafts((current) => ({
      ...current,
      [selectedPolicy.id]: {
        policy: nextPolicy,
        revision: selectedDraft.revision,
        dirty: !jsonEqual(selectedPolicy.policy, nextPolicy),
      },
    }));
    setNotice(null);
  }

  function resetToLatestRevision() {
    if (!selectedPolicy || pending) return;
    if (selectedDraft?.dirty) {
      const confirmed = window.confirm(
        'このPolicyには未保存の変更があります。破棄してサーバー上の最新Revisionへ戻しますか？',
      );
      if (!confirmed) return;
    }
    setDrafts((current) => ({
      ...current,
      [selectedPolicy.id]: {
        policy: selectedPolicy.policy,
        revision: selectedPolicy.revision,
        dirty: false,
      },
    }));
    setNotice({ kind: 'success', text: 'サーバー上の最新Revisionへ戻しました。' });
  }

  async function save() {
    if (!selectedPolicy || !selectedDraft || !draft || !canEdit || pending || !dirty) return;
    if (stale) {
      setNotice({
        kind: 'error',
        text: 'このPolicyは別の操作で更新されています。未保存のdraftを確認し、最新Revisionへ戻してから再編集してください。',
      });
      return;
    }

    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/access-policies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        body: JSON.stringify({
          policyId: selectedPolicy.id,
          expectedRevision: selectedDraft.revision,
          name: selectedPolicy.name,
          description: selectedPolicy.description ?? '',
          policy: draft,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        policy?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(
          describeStudioApiError(
            response.status,
            result,
            '細粒度Policyの保存に失敗しました',
            'access-control',
          ),
        );
      }

      const savedRevision = readPolicyRevision(result?.policy) ?? selectedDraft.revision + 1;
      setDrafts((current) => ({
        ...current,
        [selectedPolicy.id]: {
          policy: draft,
          revision: savedRevision,
          dirty: false,
        },
      }));
      setNotice({ kind: 'success', text: 'ページ・設定項目の権限を保存しました。' });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: isTimeoutError(error)
          ? 'Policyの保存がタイムアウトしました。通信状態を確認して再実行してください。'
          : error instanceof Error
            ? error.message
            : '細粒度Policyの保存に失敗しました。',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-primary/20 bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Granular permission matrix</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            ページ単位、Pluginの設定項目単位で Allow / Deny / Inherit
            を指定します。明示DenyはRole・User・Groupの別PolicyにあるAllowより優先されます。
          </p>
        </div>
        {!canEdit ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-300">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> 閲覧のみ
          </span>
        ) : null}
      </div>

      {policies.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border p-6 text-sm text-muted">
          先にManaged
          Policyを1件作成してください。作成後、このMatrixからページ・設定項目単位の権限を指定できます。
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
            <label className="text-sm font-semibold">
              編集するPolicy
              <select
                value={selectedPolicyId}
                onChange={(event) => {
                  setSelectedPolicyId(event.target.value);
                  setNotice(null);
                }}
                disabled={pending}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {policies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name} · rev.{policy.revision}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Resourceを検索
              <span className="relative mt-2 block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Moderation、autoMentionLimit、studio.page.view…"
                  className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </span>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-full border border-border bg-background px-2.5 py-1">
              Statements {draft?.Statement.length ?? 0}/{MAX_POLICY_STATEMENTS}
            </span>
            <span>多数の権限は用途別Policyへ分けて同じUser / Group / RoleへAttachできます。</span>
          </div>

          {stale ? (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="leading-6 text-muted">
                このPolicyはサーバー側でrev.{selectedPolicy?.revision}
                へ更新されています。未保存draftは保持しているため、自動上書きしていません。
              </p>
              <button
                type="button"
                onClick={resetToLatestRevision}
                disabled={pending}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-semibold disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> 最新Revisionへ戻す
              </button>
            </div>
          ) : null}

          <div className="mt-5 space-y-5">
            {groupedOptions.map(([category, categoryOptions]) => (
              <section key={category} className="overflow-hidden rounded-xl border border-border">
                <div className="border-b border-border bg-background px-4 py-3">
                  <h3 className="text-sm font-semibold">{category}</h3>
                  <p className="mt-0.5 text-xs text-muted">{categoryOptions.length} permissions</p>
                </div>
                <div className="divide-y divide-border">
                  {categoryOptions.map((option) => {
                    const mode = draft
                      ? getExplicitPermissionMode(draft, option.action, option.resource)
                      : 'inherit';
                    return (
                      <div
                        key={option.id}
                        className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_12rem] lg:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">{option.label}</p>
                            <code className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted">
                              {option.action}
                            </code>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted">{option.description}</p>
                          <code className="mt-1 block break-all text-[10px] text-muted/80">
                            {option.resource}
                          </code>
                        </div>
                        <label className="text-xs font-semibold text-muted">
                          Effect
                          <select
                            value={mode}
                            onChange={(event) => {
                              const nextMode = parseExplicitPermissionMode(event.target.value);
                              if (nextMode) changeMode(option, nextMode);
                            }}
                            disabled={!canEdit || pending || !draft || stale}
                            aria-label={`${option.label}のEffect`}
                            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${effectClassName(mode)}`}
                          >
                            <option value="inherit">Inherit</option>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                          </select>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {groupedOptions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
                一致するResourceがありません。
              </div>
            ) : null}
          </div>

          <div className="sticky bottom-4 z-20 mt-5 flex flex-col gap-3 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p
              className={`text-sm ${notice?.kind === 'error' ? 'text-red-300' : 'text-muted'}`}
              aria-live="polite"
            >
              {notice?.text ??
                (stale
                  ? '最新Revisionへ同期するまで保存できません。'
                  : dirty
                    ? '未保存の権限変更があります。'
                    : 'Policyは保存済みです。')}
            </p>
            <button
              type="button"
              onClick={save}
              disabled={!canEdit || pending || !dirty || stale}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {pending ? '保存中…' : '細粒度権限を保存'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function groupByCategory(
  options: readonly StudioGranularPermissionOption[],
): Array<[string, StudioGranularPermissionOption[]]> {
  const groups = new Map<string, StudioGranularPermissionOption[]>();
  for (const option of options) {
    const current = groups.get(option.category) ?? [];
    current.push(option);
    groups.set(option.category, current);
  }
  return [...groups.entries()];
}

function parseExplicitPermissionMode(value: string): ExplicitPermissionMode | null {
  return value === 'inherit' || value === 'allow' || value === 'deny' ? value : null;
}

function effectClassName(mode: ExplicitPermissionMode): string {
  switch (mode) {
    case 'allow':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'deny':
      return 'border-red-500/30 bg-red-500/10 text-red-200';
    default:
      return 'border-border bg-background text-foreground';
  }
}

function readPolicyRevision(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const revision = (value as Record<string, unknown>)['revision'];
  return Number.isInteger(revision) && Number(revision) > 0 ? Number(revision) : null;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
