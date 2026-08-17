'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeStudioApiError } from '@/lib/studio-api-feedback';
import { Braces, Plus, Save, Trash2, UserPlus } from 'lucide-react';
import {
  STUDIO_ACCESS_POLICY_VERSION,
  STUDIO_GUI_PERMISSION_SID,
  STUDIO_POLICY_ACTIONS,
  setStudioGuiActions,
  validateStudioAccessPolicy,
  type StudioAccessPolicy,
  type StudioPolicyAction,
} from '@/lib/studio-access-policy';

interface ManagedPolicyView {
  id: string;
  name: string;
  description: string | null;
  policy: StudioAccessPolicy;
  revision: number;
  updatedAt: string;
}

interface AttachmentView {
  policyId: string;
  principalType: 'role' | 'user' | 'group';
  principalId: string;
}

interface PrincipalOption {
  id: string;
  name: string;
}

const ACTION_LABELS: Record<StudioPolicyAction, string> = {
  'studio.page.view': 'ページ閲覧',
  'studio.settings.read': '設定閲覧',
  'studio.settings.write': '設定編集',
  'studio.resource.create': 'リソース作成',
  'studio.resource.update': 'リソース編集',
  'studio.resource.delete': 'リソース削除',
  'studio.operation.execute': '運用操作',
  'studio.roles.read': 'Access Control閲覧',
  'studio.roles.manage': 'Access Control管理',
  'studio.secrets.manage': 'Secret管理',
  'studio.commands.execute': 'Command実行',
  'studio.ai.use': 'AI利用',
  'studio.ai.manage': 'AI設定管理',
  'studio.rag.manage': 'RAG管理',
  'studio.mcp.manage': 'MCP管理',
};

export function ManagedPolicyManager({
  guildId,
  policies,
  attachments,
  roles,
  groups,
  canEdit,
}: {
  guildId: string;
  policies: ManagedPolicyView[];
  attachments: AttachmentView[];
  roles: PrincipalOption[];
  groups: PrincipalOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selectedPolicyId, setSelectedPolicyId] = useState(policies[0]?.id ?? 'new');
  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) ?? null;
  const [name, setName] = useState(selectedPolicy?.name ?? '');
  const [description, setDescription] = useState(selectedPolicy?.description ?? '');
  const [draft, setDraft] = useState(
    JSON.stringify(selectedPolicy?.policy ?? emptyPolicy(), null, 2),
  );
  const [mode, setMode] = useState<'gui' | 'json'>('gui');
  const [pending, setPending] = useState(false);
  const [userId, setUserId] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const lastSyncedPolicyKey = useRef<string | null>(null);

  useEffect(() => {
    const next = policies.find((policy) => policy.id === selectedPolicyId) ?? null;
    const syncKey = next
      ? `${next.id}:${next.revision}`
      : selectedPolicyId === 'new'
        ? 'new'
        : null;
    if (!syncKey || lastSyncedPolicyKey.current === syncKey) return;
    lastSyncedPolicyKey.current = syncKey;
    setName(next?.name ?? '');
    setDescription(next?.description ?? '');
    setDraft(JSON.stringify(next?.policy ?? emptyPolicy(), null, 2));
  }, [policies, selectedPolicyId]);

  const parsedDraft = parsePolicy(draft, guildId);
  const selectedActions = extractGuiActions(parsedDraft);
  const selectedAttachments = useMemo(
    () => attachments.filter((attachment) => attachment.policyId === selectedPolicyId),
    [attachments, selectedPolicyId],
  );
  const directUsers = selectedAttachments.filter(
    (attachment) => attachment.principalType === 'user',
  );

  function selectPolicy(policyId: string) {
    setSelectedPolicyId(policyId);
    setNotice(null);
  }

  function startNew() {
    setSelectedPolicyId('new');
    setName('');
    setDescription('');
    setDraft(JSON.stringify(emptyPolicy(), null, 2));
    setNotice(null);
  }

  function toggleAction(action: StudioPolicyAction) {
    if (!parsedDraft) {
      setNotice({
        kind: 'error',
        text: 'Policy JSONが不正です。JSONタブで修正してからGUIを操作してください。',
      });
      return;
    }
    const next = new Set(selectedActions);
    if (next.has(action)) next.delete(action);
    else next.add(action);
    setDraft(JSON.stringify(setStudioGuiActions(parsedDraft, guildId, [...next]), null, 2));
    setNotice(null);
  }

  async function savePolicy() {
    if (!canEdit || pending) return;
    if (!parsedDraft) {
      setNotice({
        kind: 'error',
        text: 'Policy JSONまたはPolicy documentが不正です。JSONタブで修正してください。',
      });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const isNew = selectedPolicyId === 'new';
      if (!isNew && !selectedPolicy) throw new Error('Policyの最新状態を確認できません');
      const response = await fetch(`/api/guilds/${guildId}/access-policies`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isNew
            ? {}
            : { policyId: selectedPolicyId, expectedRevision: selectedPolicy?.revision }),
          name,
          description,
          policy: parsedDraft,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        details?: string[];
        policy?: ManagedPolicyView;
      } | null;
      if (!response.ok) {
        throw new Error(
          describeStudioApiError(response.status, result, '保存に失敗しました', 'access-control'),
        );
      }
      if (isNew && result?.policy?.id) setSelectedPolicyId(result.policy.id);
      setNotice({
        kind: 'success',
        text: isNew ? 'Policyを作成しました。' : 'Policyを更新しました。',
      });
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
    if (!canEdit || !selectedPolicy || pending) return;
    if (
      !window.confirm(`Policy「${selectedPolicy.name}」を削除しますか？Attachmentも削除されます。`)
    )
      return;
    setPending(true);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/access-policies?policyId=${encodeURIComponent(selectedPolicy.id)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(
          describeStudioApiError(response.status, result, '削除に失敗しました', 'access-control'),
        );
      }
      setSelectedPolicyId('new');
      setNotice({ kind: 'success', text: 'Policyを削除しました。' });
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

  async function setAttachment(
    principalType: 'role' | 'user' | 'group',
    principalId: string,
    attached: boolean,
  ) {
    if (!canEdit || !selectedPolicy || pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/access-policies/attachments`, {
        method: attached ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyId: selectedPolicy.id, principalType, principalId }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(
          describeStudioApiError(
            response.status,
            result,
            'Attachment更新に失敗しました',
            'access-control',
          ),
        );
      }
      setNotice({
        kind: 'success',
        text: attached ? 'PolicyをAttachしました。' : 'PolicyをDetachしました。',
      });
      if (principalType === 'user' && attached) setUserId('');
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Attachment更新に失敗しました。',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Policies</p>
          <h2 className="mt-1 text-xl font-semibold">Managed Policy</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Policyを一度定義し、Discord Role・User・Herta
            GroupへAttachします。Denyはすべての経路より優先されます。
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          disabled={!canEdit || pending}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> 新規Policy
        </button>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-background p-3">
          <nav className="space-y-1" aria-label="Managed Policy一覧">
            {policies.map((policy) => (
              <button
                key={policy.id}
                type="button"
                onClick={() => selectPolicy(policy.id)}
                aria-pressed={selectedPolicyId === policy.id}
                className={`w-full rounded-lg px-3 py-2 text-left ${selectedPolicyId === policy.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface'}`}
              >
                <span className="block truncate text-sm font-semibold">{policy.name}</span>
                <span className="mt-0.5 block text-xs text-muted">rev.{policy.revision}</span>
              </button>
            ))}
            {policies.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted">Policyはまだありません。</p>
            ) : null}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Policy名
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canEdit || pending}
                maxLength={100}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="text-sm font-semibold">
              説明
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!canEdit || pending}
                maxLength={500}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Policy document</h3>
              <div
                className="flex rounded-xl border border-border bg-background p-1"
                role="group"
                aria-label="Policy編集モード"
              >
                <button
                  type="button"
                  aria-pressed={mode === 'gui'}
                  onClick={() => setMode('gui')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === 'gui' ? 'bg-primary text-primary-foreground' : ''}`}
                >
                  GUI
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'json'}
                  onClick={() => setMode('json')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === 'json' ? 'bg-primary text-primary-foreground' : ''}`}
                >
                  <Braces className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                  JSON
                </button>
              </div>
            </div>
            {mode === 'gui' ? (
              <div className="mt-3 space-y-3">
                {!parsedDraft ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
                  >
                    Policy JSONが不正です。JSONタブで修正するまでGUI操作は無効です。
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  {STUDIO_POLICY_ACTIONS.map((action) => (
                    <label
                      key={action}
                      className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedActions.has(action)}
                        onChange={() => toggleAction(action)}
                        disabled={!canEdit || pending || !parsedDraft}
                      />
                      <span>
                        <span className="font-semibold">{ACTION_LABELS[action]}</span>
                        <code className="mt-0.5 block text-[10px] text-muted">{action}</code>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                readOnly={!canEdit}
                spellCheck={false}
                aria-label="Policy JSON"
                aria-invalid={!parsedDraft}
                className="mt-3 min-h-[24rem] w-full rounded-xl border border-border bg-background p-4 font-mono text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </div>

          {selectedPolicy ? (
            <div className="space-y-4 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">Attach先</h3>
              <PrincipalChecklist
                title="Discord Roles"
                options={roles}
                type="role"
                attachments={selectedAttachments}
                disabled={!canEdit || pending}
                onChange={setAttachment}
              />
              <PrincipalChecklist
                title="Herta Groups"
                options={groups}
                type="group"
                attachments={selectedAttachments}
                disabled={!canEdit || pending}
                onChange={setAttachment}
              />
              <div className="rounded-xl border border-border bg-background p-4">
                <h4 className="text-sm font-semibold">Direct Users</h4>
                <div className="mt-3 flex gap-2">
                  <input
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                    placeholder="Discord User ID"
                    inputMode="numeric"
                    disabled={!canEdit || pending}
                    className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => void setAttachment('user', userId.trim(), true)}
                    disabled={!canEdit || pending || !/^\d{17,20}$/u.test(userId.trim())}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                    Attach
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {directUsers.map((attachment) => (
                    <button
                      key={attachment.principalId}
                      type="button"
                      onClick={() => void setAttachment('user', attachment.principalId, false)}
                      disabled={!canEdit || pending}
                      className="rounded-full border border-border px-3 py-1 font-mono text-xs hover:border-red-500/40 hover:text-red-600"
                    >
                      {attachment.principalId} ×
                    </button>
                  ))}
                  {directUsers.length === 0 ? (
                    <span className="text-xs text-muted">Direct User attachmentなし</span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {notice ? (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`whitespace-pre-line rounded-xl border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'}`}
            >
              {notice.text}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => void savePolicy()}
              disabled={!canEdit || pending || name.trim().length === 0 || !parsedDraft}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {selectedPolicy ? '更新' : '作成'}
            </button>
            {selectedPolicy ? (
              <button
                type="button"
                onClick={() => void deletePolicy()}
                disabled={!canEdit || pending}
                className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Policy削除
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function PrincipalChecklist({
  title,
  options,
  type,
  attachments,
  disabled,
  onChange,
}: {
  title: string;
  options: PrincipalOption[];
  type: 'role' | 'group';
  attachments: AttachmentView[];
  disabled: boolean;
  onChange: (type: 'role' | 'user' | 'group', id: string, attached: boolean) => Promise<void>;
}) {
  const attachedIds = new Set(
    attachments
      .filter((attachment) => attachment.principalType === type)
      .map((attachment) => attachment.principalId),
  );
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              checked={attachedIds.has(option.id)}
              onChange={(event) => void onChange(type, option.id, event.target.checked)}
              disabled={disabled}
            />
            <span className="min-w-0">
              <span className="block truncate font-medium">{option.name}</span>
              <code className="block truncate text-[10px] text-muted">{option.id}</code>
            </span>
          </label>
        ))}
        {options.length === 0 ? <span className="text-xs text-muted">対象なし</span> : null}
      </div>
    </div>
  );
}

function emptyPolicy(): StudioAccessPolicy {
  return { Version: STUDIO_ACCESS_POLICY_VERSION, Statement: [] };
}

function parsePolicy(value: string, guildId: string): StudioAccessPolicy | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    const validation = validateStudioAccessPolicy(parsed, guildId);
    return validation.valid ? (validation.policy ?? null) : null;
  } catch {
    return null;
  }
}

function extractGuiActions(policy: StudioAccessPolicy | null): Set<StudioPolicyAction> {
  if (!policy || !Array.isArray(policy.Statement)) return new Set();
  const supported = new Set<string>(STUDIO_POLICY_ACTIONS);
  const guiStatement = policy.Statement.find(
    (statement) => statement.Sid === STUDIO_GUI_PERMISSION_SID && statement.Effect === 'Allow',
  );
  if (!guiStatement) return new Set();
  return new Set(
    (Array.isArray(guiStatement.Action) ? guiStatement.Action : []).filter(
      (action): action is StudioPolicyAction => supported.has(action),
    ),
  );
}
