'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Clock3, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import type { RoleInventoryRole } from '@/lib/role-access-inventory';
import { lifecycleStatusLabel } from '@/lib/discord-role-lifecycle';

export interface RoleLifecycleOperationView {
  id: string;
  operationType: string;
  status: string;
  executeAt: string;
  roleId: string | null;
  roleName: string;
  expiresAt: string | null;
  lastError: string | null;
  createdAt: string;
}

type CreateTiming = 'now' | 'scheduled';
type ExpirationMode = 'permanent' | 'duration' | 'at';

export function RoleLifecycleManager({
  guildId,
  roles,
  rootRoleId,
  operations,
  canEdit,
}: {
  guildId: string;
  roles: RoleInventoryRole[];
  rootRoleId: string;
  operations: RoleLifecycleOperationView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#5865F2');
  const [hoist, setHoist] = useState(false);
  const [mentionable, setMentionable] = useState(false);
  const [timing, setTiming] = useState<CreateTiming>('now');
  const [createAt, setCreateAt] = useState('');
  const [expirationMode, setExpirationMode] = useState<ExpirationMode>('permanent');
  const [durationHours, setDurationHours] = useState('24');
  const [expiresAt, setExpiresAt] = useState('');
  const [deleteRoleId, setDeleteRoleId] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const deletableRoles = useMemo(
    () =>
      roles.filter(
        (role) => role.id !== guildId && role.id !== rootRoleId && !role.managed && role.editable,
      ),
    [guildId, roles, rootRoleId],
  );
  const selectedDeleteRole = deletableRoles.find((role) => role.id === deleteRoleId);

  async function createRole() {
    if (!canEdit || pending) return;
    const scheduledDate = timing === 'scheduled' ? parseLocalDate(createAt) : null;
    if (timing === 'scheduled' && !scheduledDate) {
      setNotice({ kind: 'error', text: '作成予定日時を指定してください。' });
      return;
    }
    const base = scheduledDate ?? new Date();
    const expiry = resolveExpiry(base);
    if (expirationMode !== 'permanent' && !expiry) {
      setNotice({ kind: 'error', text: '削除日時または有効期間を正しく指定してください。' });
      return;
    }

    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/discord-roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          name,
          color,
          hoist,
          mentionable,
          createAt: scheduledDate?.toISOString() ?? null,
          expiresAt: expiry?.toISOString() ?? null,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        details?: string[];
        attention?: boolean;
      } | null;
      if (!response.ok) {
        throw new Error(
          [result?.error, ...(result?.details ?? [])].filter(Boolean).join(' / ') ||
            'Role作成に失敗しました',
        );
      }
      setNotice({
        kind: 'success',
        text: timing === 'scheduled' ? 'Role作成を予約しました。' : 'Discord Roleを作成しました。',
      });
      if (timing === 'now') setName('');
      router.refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Role作成に失敗しました。' });
    } finally {
      setPending(false);
    }
  }

  async function deleteRole() {
    if (!selectedDeleteRole || !canEdit || pending) return;
    const confirmed = window.confirm(
      `Discord Role「${selectedDeleteRole.name}」を削除します。\nこのRoleを持つ全メンバーから解除されます。この操作は取り消せません。`,
    );
    if (!confirmed) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/discord-roles/${encodeURIComponent(selectedDeleteRole.id)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        references?: string[];
      } | null;
      if (!response.ok) {
        const references = result?.references?.length ? ` (${result.references.join(', ')})` : '';
        throw new Error(`${result?.error ?? 'Role削除に失敗しました'}${references}`);
      }
      setNotice({ kind: 'success', text: `${selectedDeleteRole.name} を削除しました。` });
      setDeleteRoleId('');
      router.refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Role削除に失敗しました。' });
    } finally {
      setPending(false);
    }
  }

  async function cancelOperation(operationId: string) {
    if (!canEdit || pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/discord-roles?operationId=${encodeURIComponent(operationId)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? '予約のキャンセルに失敗しました');
      setNotice({ kind: 'success', text: '待機中のRole lifecycle予約をキャンセルしました。' });
      router.refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'キャンセルに失敗しました。' });
    } finally {
      setPending(false);
    }
  }

  function resolveExpiry(base: Date): Date | null {
    if (expirationMode === 'permanent') return null;
    if (expirationMode === 'at') return parseLocalDate(expiresAt);
    const hours = Number(durationHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 366 * 24) return null;
    return new Date(base.getTime() + hours * 60 * 60 * 1000);
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarClock className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Discord Role Lifecycle</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Roleの作成・削除・予約作成・期限切れ自動削除を管理します。作成時のDiscord権限は安全のため0から開始します。
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-background/50 p-4">
          <h3 className="font-semibold">Roleを作成</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="text-xs font-medium">Role名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={!canEdit || pending} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <label>
              <span className="text-xs font-medium">色</span>
              <div className="mt-1 flex gap-2">
                <input type="color" value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} disabled={!canEdit || pending} className="h-10 w-12 rounded-lg border border-border bg-surface p-1" aria-label="Roleの色" />
                <input value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} maxLength={7} disabled={!canEdit || pending} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-sm" aria-label="Role色のHEX値" />
              </div>
            </label>
            <label>
              <span className="text-xs font-medium">作成タイミング</span>
              <select value={timing} onChange={(event) => setTiming(event.target.value as CreateTiming)} disabled={!canEdit || pending} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm">
                <option value="now">今すぐ</option>
                <option value="scheduled">指定日時</option>
              </select>
            </label>
            {timing === 'scheduled' ? (
              <label className="sm:col-span-2">
                <span className="text-xs font-medium">作成予定日時</span>
                <input type="datetime-local" value={createAt} onChange={(event) => setCreateAt(event.target.value)} disabled={!canEdit || pending} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
              </label>
            ) : null}
            <label>
              <span className="text-xs font-medium">有効期間</span>
              <select value={expirationMode} onChange={(event) => setExpirationMode(event.target.value as ExpirationMode)} disabled={!canEdit || pending} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm">
                <option value="permanent">無期限</option>
                <option value="duration">一定時間後に削除</option>
                <option value="at">指定日時に削除</option>
              </select>
            </label>
            {expirationMode === 'duration' ? (
              <label>
                <span className="text-xs font-medium">有効時間（時間）</span>
                <input type="number" min={1} max={8784} value={durationHours} onChange={(event) => setDurationHours(event.target.value)} disabled={!canEdit || pending} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
              </label>
            ) : expirationMode === 'at' ? (
              <label>
                <span className="text-xs font-medium">削除予定日時</span>
                <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={!canEdit || pending} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
              </label>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={hoist} onChange={(event) => setHoist(event.target.checked)} disabled={!canEdit || pending} />メンバー一覧で分けて表示</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={mentionable} onChange={(event) => setMentionable(event.target.checked)} disabled={!canEdit || pending} />メンション可能</label>
          </div>
          <button type="button" onClick={() => void createRole()} disabled={!canEdit || pending || !name.trim()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden="true" />{pending ? '処理中…' : timing === 'scheduled' ? '作成を予約' : 'Roleを作成'}
          </button>
        </div>

        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-4">
          <div className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 text-red-500" aria-hidden="true" /><div><h3 className="font-semibold">Discord Roleを削除</h3><p className="mt-1 text-xs leading-5 text-muted">参照中のHerta設定、root、Managed Role、Bot以上のRoleは削除できません。</p></div></div>
          <label className="mt-4 block"><span className="text-xs font-medium">削除対象</span><select value={deleteRoleId} onChange={(event) => setDeleteRoleId(event.target.value)} disabled={!canEdit || pending} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"><option value="">Roleを選択</option>{deletableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <button type="button" onClick={() => void deleteRole()} disabled={!canEdit || pending || !selectedDeleteRole} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" aria-hidden="true" />Discord Roleを削除</button>
        </div>
      </div>

      {notice ? <p role="status" className={`mt-4 rounded-xl border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>{notice.text}</p> : null}

      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-muted" aria-hidden="true" /><h3 className="text-sm font-semibold">Lifecycle operations</h3></div>
        {operations.length === 0 ? <p className="mt-3 text-sm text-muted">予約・実行履歴はまだありません。</p> : <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">{operations.map((operation) => <div key={operation.id} className="flex flex-col gap-3 bg-background/50 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{operation.operationType === 'create' ? '作成' : '削除'} · {operation.roleName}</span><span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">{lifecycleStatusLabel(operation.status)}</span></div><p className="mt-1 text-xs text-muted">実行: {formatDate(operation.executeAt)}{operation.expiresAt ? ` / 期限: ${formatDate(operation.expiresAt)}` : ''}</p>{operation.lastError ? <p className="mt-1 font-mono text-[10px] text-amber-600">{operation.lastError}</p> : null}</div>{operation.status === 'pending' ? <button type="button" onClick={() => void cancelOperation(operation.id)} disabled={!canEdit || pending} className="self-start rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-background disabled:opacity-40">キャンセル</button> : null}</div>)}</div>}
      </div>
    </section>
  );
}

function parseLocalDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP');
}
