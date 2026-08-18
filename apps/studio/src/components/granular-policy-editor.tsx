'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole, Save, Search, ShieldCheck } from 'lucide-react';
import { describeStudioApiError } from '@/lib/studio-api-feedback';
import type { StudioAccessPolicy } from '@/lib/studio-access-policy';
import {
  getExplicitPermissionMode,
  setExplicitPermissionMode,
  type ExplicitPermissionMode,
} from '@/lib/studio-plugin-permissions';
import type { StudioGranularPermissionOption } from '@/lib/studio-policy-resources';

const MAX_POLICY_STATEMENTS = 64;

interface GranularPolicyView {
  id: string;
  name: string;
  description: string | null;
  policy: StudioAccessPolicy;
  revision: number;
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
  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) ?? null;
  const [draft, setDraft] = useState<StudioAccessPolicy | null>(selectedPolicy?.policy ?? null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const lastSyncedKey = useRef<string | null>(null);

  useEffect(() => {
    const next = policies.find((policy) => policy.id === selectedPolicyId) ?? null;
    const key = next ? `${next.id}:${next.revision}` : null;
    if (!key || lastSyncedKey.current === key) return;
    lastSyncedKey.current = key;
    setDraft(next.policy);
    setNotice(null);
  }, [policies, selectedPolicyId]);

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
  const dirty = Boolean(
    selectedPolicy && draft && JSON.stringify(selectedPolicy.policy) !== JSON.stringify(draft),
  );

  function changeMode(option: StudioGranularPermissionOption, mode: ExplicitPermissionMode) {
    if (!draft || !canEdit || pending) return;
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
    setDraft(setExplicitPermissionMode(draft, option.action, option.resource, mode));
    setNotice(null);
  }

  async function save() {
    if (!selectedPolicy || !draft || !canEdit || pending || !dirty) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/access-policies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyId: selectedPolicy.id,
          expectedRevision: selectedPolicy.revision,
          name: selectedPolicy.name,
          description: selectedPolicy.description ?? '',
          policy: draft,
        }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
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
      setNotice({ kind: 'success', text: 'ページ・設定項目の権限を保存しました。' });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : '細粒度Policyの保存に失敗しました。',
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
          先にManaged Policyを1件作成してください。作成後、このMatrixからページ・設定項目単位の権限を指定できます。
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
            <label className="text-sm font-semibold">
              編集するPolicy
              <select
                value={selectedPolicyId}
                onChange={(event) => setSelectedPolicyId(event.target.value)}
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
                            disabled={!canEdit || pending || !draft}
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
              {notice?.text ?? (dirty ? '未保存の権限変更があります。' : 'Policyは保存済みです。')}
            </p>
            <button
              type="button"
              onClick={save}
              disabled={!canEdit || pending || !dirty}
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
