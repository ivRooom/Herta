'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Braces, LockKeyhole, Save, Trash2 } from 'lucide-react';
import { RoleInventorySelector } from '@/components/role-inventory-selector';
import type { RoleInventoryRole } from '@/lib/role-access-inventory';
import {
  STUDIO_ACCESS_POLICY_VERSION,
  STUDIO_GUI_PERMISSION_SID,
  STUDIO_POLICY_ACTIONS,
  setStudioGuiActions,
  type StudioAccessPolicy,
  type StudioPolicyAction,
} from '@/lib/studio-access-policy';
import type { StudioRolePolicyRecord } from '@/lib/studio-role-policy-store';

const ACTION_LABELS: Record<StudioPolicyAction, { label: string; description: string }> = {
  'studio.page.view': { label: 'ページ閲覧', description: '許可されたStudioページを閲覧' },
  'studio.settings.read': { label: '設定閲覧', description: '設定値を参照' },
  'studio.settings.write': { label: '設定編集', description: '一般設定を変更' },
  'studio.resource.create': { label: '作成', description: 'ルールやコンテンツを新規作成' },
  'studio.resource.update': { label: '編集', description: '既存リソースを変更' },
  'studio.resource.delete': { label: '削除', description: '既存リソースを削除' },
  'studio.operation.execute': { label: '操作実行', description: '運用系アクションを実行' },
  'studio.roles.read': { label: 'Role Policy閲覧', description: 'Role Managerを参照' },
  'studio.roles.manage': {
    label: 'Role管理',
    description: 'Role Policy管理権限（v1の変更操作はroot限定）',
  },
  'studio.secrets.manage': { label: 'Secret管理', description: 'AI API Key等の機密設定を管理' },
  'studio.commands.execute': { label: 'Command実行', description: 'StudioからHerta Commandを実行' },
  'studio.ai.use': { label: 'AI利用', description: 'Herta AIへ質問・生成を依頼' },
  'studio.ai.manage': { label: 'AI設定管理', description: 'モデル・人格・予算等を変更' },
  'studio.rag.manage': { label: 'RAG管理', description: 'Knowledge Baseを追加・更新' },
  'studio.mcp.manage': { label: 'MCP管理', description: 'MCP ServerとTool権限を管理' },
};

export function RolePolicyManager({
  guildId,
  roles,
  policies,
  rootRoleId,
  canEdit,
}: {
  guildId: string;
  roles: RoleInventoryRole[];
  policies: StudioRolePolicyRecord[];
  rootRoleId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const policyMap = useMemo(
    () => new Map(policies.map((policy) => [policy.discordRoleId, policy])),
    [policies],
  );
  const configuredRoleIds = useMemo(
    () => policies.map((policy) => policy.discordRoleId),
    [policies],
  );
  const firstEditable = roles.find((role) => role.id !== rootRoleId)?.id ?? roles[0]?.id ?? '';
  const [selectedRoleId, setSelectedRoleId] = useState(firstEditable);
  const [editorMode, setEditorMode] = useState<'gui' | 'json'>('gui');
  const [draftByRole, setDraftByRole] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const selectedRole = roles.find((role) => role.id === selectedRoleId);
  const storedPolicy = policyMap.get(selectedRoleId)?.policy;
  const draft =
    draftByRole[selectedRoleId] ?? JSON.stringify(storedPolicy ?? emptyPolicy(), null, 2);
  const parsedDraft = parsePolicy(draft);
  const selectedActions = extractGuiActions(parsedDraft);
  const isProtectedRoot = selectedRoleId === rootRoleId;
  const hasStoredPolicy = policyMap.has(selectedRoleId);

  function setDraft(value: string) {
    setDraftByRole((current) => ({ ...current, [selectedRoleId]: value }));
    setNotice(null);
  }

  function toggleAction(action: StudioPolicyAction) {
    const next = new Set(selectedActions);
    if (next.has(action)) next.delete(action);
    else next.add(action);
    const currentPolicy = parsedDraft ?? emptyPolicy();
    setDraft(JSON.stringify(setStudioGuiActions(currentPolicy, guildId, [...next]), null, 2));
  }

  async function savePolicy() {
    if (!selectedRole || isProtectedRoot || !canEdit) return;
    let policy: unknown;
    try {
      policy = JSON.parse(draft);
    } catch {
      setNotice({ kind: 'error', text: 'JSONの構文が正しくありません。' });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/role-policies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordRoleId: selectedRole.id, policy }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        details?: string[];
      } | null;
      if (!response.ok)
        throw new Error(
          [result?.error, ...(result?.details ?? [])].filter(Boolean).join(' / ') ||
            '保存に失敗しました',
        );
      setNotice({ kind: 'success', text: `${selectedRole.name} のPolicyを保存しました。` });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : '保存に失敗しました。',
      });
    } finally {
      setPending(false);
    }
  }

  async function deletePolicy() {
    if (!selectedRole || !policyMap.has(selectedRole.id) || isProtectedRoot || !canEdit) return;
    if (!window.confirm(`${selectedRole.name} のStudio Policyを削除しますか？`)) return;
    setPending(true);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/role-policies?roleId=${encodeURIComponent(selectedRole.id)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || '削除に失敗しました');
      setDraftByRole((current) => ({
        ...current,
        [selectedRole.id]: JSON.stringify(emptyPolicy(), null, 2),
      }));
      setNotice({ kind: 'success', text: `${selectedRole.name} のPolicyを削除しました。` });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : '削除に失敗しました。',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <RoleInventorySelector
        roles={roles}
        selectedRoleId={selectedRoleId}
        onSelect={(roleId) => {
          setSelectedRoleId(roleId);
          setNotice(null);
        }}
        configuredRoleIds={configuredRoleIds}
        rootRoleId={rootRoleId}
        title="Access inventory"
        description="Role名・ID、Policy状態、Discord管理Roleで絞り込みできます。リストを基本に、グリッド表示へも切り替えられます。"
      />

      <section className="min-w-0 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Selected Role
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-xl font-semibold">
                {selectedRole?.name ?? 'Roleを選択'}
              </h2>
              {isProtectedRoot ? <RoleStateBadge label="root" emphasis="warning" /> : null}
              {!isProtectedRoot && hasStoredPolicy ? (
                <RoleStateBadge label="Policy設定済み" emphasis="success" />
              ) : null}
              {!isProtectedRoot && !hasStoredPolicy ? <RoleStateBadge label="新規Policy" /> : null}
              {selectedRole?.managed ? <RoleStateBadge label="Discord Managed" /> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="break-all font-mono">{selectedRoleId}</span>
              {selectedRole ? <span>Hierarchy #{selectedRole.position}</span> : null}
            </div>
          </div>
          {!isProtectedRoot ? (
            <div
              className="flex rounded-xl border border-border bg-background p-1"
              role="tablist"
              aria-label="Policy編集モード"
            >
              <button
                type="button"
                role="tab"
                aria-selected={editorMode === 'gui'}
                onClick={() => setEditorMode('gui')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${editorMode === 'gui' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                GUI
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editorMode === 'json'}
                onClick={() => setEditorMode('json')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${editorMode === 'json' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Braces className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                JSON
              </button>
            </div>
          ) : null}
        </div>

        {isProtectedRoot ? (
          <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
            <div className="flex gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              <div>
                <h3 className="font-semibold">OWNER root Role</h3>
                <p className="mt-1 text-sm leading-6 text-muted">
                  このRoleはHerta
                  Studioの最強権限です。Policyによる上書き・削除はできず、すべてのActionとResourceを許可します。
                </p>
              </div>
            </div>
          </div>
        ) : editorMode === 'gui' ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {STUDIO_POLICY_ACTIONS.map((action) => {
              const checked = selectedActions.has(action);
              return (
                <label
                  key={action}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${checked ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAction(action)}
                    disabled={!canEdit || pending}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {ACTION_LABELS[action].label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">
                      {ACTION_LABELS[action].description}
                    </span>
                    <code className="mt-1 block text-[10px] text-muted">{action}</code>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="mt-6">
            <label htmlFor="role-policy-json" className="mb-2 block text-sm font-semibold">
              IAM-style Policy JSON
            </label>
            <textarea
              id="role-policy-json"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              readOnly={!canEdit}
              spellCheck={false}
              className="min-h-[28rem] w-full rounded-xl border border-border bg-background p-4 font-mono text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-2 text-xs text-muted">
              EffectはAllow /
              Deny、Denyが常に優先されます。ResourceはこのGuild内だけに制限されます。
            </p>
          </div>
        )}

        {notice ? (
          <p
            className={`mt-4 rounded-xl border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'}`}
            role="status"
          >
            {notice.text}
          </p>
        ) : null}

        {!isProtectedRoot ? (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => void savePolicy()}
              disabled={!canEdit || pending || !selectedRole}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              保存
            </button>
            <button
              type="button"
              onClick={() => void deletePolicy()}
              disabled={!canEdit || pending || !policyMap.has(selectedRoleId)}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Policy削除
            </button>
            {!canEdit ? (
              <p className="self-center text-xs text-muted">
                閲覧のみです。Policy変更にはOWNER root Roleが必要です。
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function RoleStateBadge({
  label,
  emphasis = 'default',
}: {
  label: string;
  emphasis?: 'default' | 'success' | 'warning';
}) {
  const className =
    emphasis === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
      : emphasis === 'warning'
        ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
        : 'border-border bg-background text-muted';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  );
}

function emptyPolicy(): StudioAccessPolicy {
  return { Version: STUDIO_ACCESS_POLICY_VERSION, Statement: [] };
}

function parsePolicy(value: string): StudioAccessPolicy | null {
  try {
    return JSON.parse(value) as StudioAccessPolicy;
  } catch {
    return null;
  }
}

function extractGuiActions(policy: StudioAccessPolicy | null): Set<StudioPolicyAction> {
  if (!policy) return new Set();
  const supported = new Set<string>(STUDIO_POLICY_ACTIONS);
  const guiStatement = policy.Statement.find(
    (statement) => statement.Sid === STUDIO_GUI_PERMISSION_SID && statement.Effect === 'Allow',
  );
  if (!guiStatement) return new Set();
  return new Set(
    guiStatement.Action.filter((action): action is StudioPolicyAction => supported.has(action)),
  );
}
