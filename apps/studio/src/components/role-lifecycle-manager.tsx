'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeStudioApiError } from '@/lib/studio-api-feedback';
import { CalendarClock, Clock3, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import type { RoleInventoryRole } from '@/lib/role-access-inventory';
import { roleDeleteBlockReason } from '@/lib/discord-role-lifecycle';

export interface RoleLifecycleOperationView {
  id: string;
  operation: 'create' | 'delete';
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  source: string;
  discordRoleId: string | null;
  roleName: string | null;
  roleColor: number | null;
  scheduledFor: string;
  expiresAfterSeconds: number | null;
  nextAttemptAt: string | null;
  attemptCount: number;
  lastErrorName: string | null;
  createdAt: string;
}

type Notice = { kind: 'success' | 'error'; text: string } | null;
type ScheduleMode = 'now' | 'scheduled';
type DurationUnit = 'minutes' | 'hours' | 'days';

const DURATION_MULTIPLIER: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
};

export function RoleLifecycleManager({
  guildId,
  roles,
  operations,
  rootRoleId,
  canEdit,
  botCanManageRoles,
}: {
  guildId: string;
  roles: RoleInventoryRole[];
  operations: RoleLifecycleOperationView[];
  rootRoleId: string;
  canEdit: boolean;
  botCanManageRoles: boolean;
}) {
  const router = useRouter();
  const deletableRoles = useMemo(
    () => roles.filter((role) => roleDeleteBlockReason(role, rootRoleId) === null),
    [roles, rootRoleId],
  );
  const [name, setName] = useState('');
  const [color, setColor] = useState('#5865F2');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('now');
  const [scheduledFor, setScheduledFor] = useState('');
  const [temporary, setTemporary] = useState(false);
  const [duration, setDuration] = useState('24');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('hours');
  const [deleteRoleId, setDeleteRoleId] = useState(deletableRoles[0]?.id ?? '');
  const [pendingAction, setPendingAction] = useState<'create' | 'delete' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const createRequestIdRef = useRef<string | null>(null);

  const selectedDeleteRole = roles.find((role) => role.id === deleteRoleId) ?? null;
  const deleteBlock = selectedDeleteRole
    ? roleDeleteBlockReason(selectedDeleteRole, rootRoleId)
    : null;
  const hasActiveOperations = operations.some(
    (operation) => operation.status === 'pending' || operation.status === 'processing',
  );

  useEffect(() => {
    if (!hasActiveOperations) return;
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [hasActiveOperations, router]);

  useEffect(() => {
    if (!deleteRoleId && deletableRoles[0]) setDeleteRoleId(deletableRoles[0].id);
  }, [deleteRoleId, deletableRoles]);

  useEffect(() => {
    createRequestIdRef.current = null;
  }, [name, color, scheduleMode, scheduledFor, temporary, duration, durationUnit]);

  const createDisabled =
    !canEdit ||
    !botCanManageRoles ||
    pendingAction !== null ||
    !name.trim() ||
    (scheduleMode === 'scheduled' && !scheduledFor) ||
    (temporary && (!Number.isFinite(Number(duration)) || Number(duration) <= 0));
  const deleteDisabled =
    !canEdit ||
    !botCanManageRoles ||
    pendingAction !== null ||
    !selectedDeleteRole ||
    deleteBlock !== null;

  async function createRole() {
    if (createDisabled) return;
    const expiresAfterSeconds = temporary
      ? Math.trunc(Number(duration) * DURATION_MULTIPLIER[durationUnit])
      : null;
    let scheduledIso: string | null = null;
    if (scheduleMode === 'scheduled' && scheduledFor) {
      const scheduledDate = new Date(scheduledFor);
      if (Number.isNaN(scheduledDate.getTime())) {
        setNotice({ kind: 'error', text: '作成日時が不正です。' });
        return;
      }
      scheduledIso = scheduledDate.toISOString();
    }

    const requestId = createRequestIdRef.current ?? crypto.randomUUID();
    createRequestIdRef.current = requestId;
    let resetRequestId = false;
    setPendingAction('create');
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestId,
        },
        body: JSON.stringify({
          name: name.trim(),
          color,
          scheduledFor: scheduledIso,
          expiresAfterSeconds,
        }),
      });
      resetRequestId = response.status < 500;
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(
          describeStudioApiError(
            response.status,
            result,
            'Role作成の受付に失敗しました',
            'role-lifecycle',
          ),
        );
      }
      setName('');
      setNotice({
        kind: 'success',
        text:
          scheduleMode === 'scheduled'
            ? 'Role作成を予約しました。'
            : 'Role作成を受け付けました。実行状態は履歴へ反映されます。',
      });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Role作成の受付に失敗しました。',
      });
    } finally {
      if (resetRequestId) createRequestIdRef.current = null;
      setPendingAction(null);
    }
  }

  async function deleteRole() {
    if (deleteDisabled || !selectedDeleteRole) return;
    const confirmed = window.confirm(
      `${selectedDeleteRole.name} をDiscordから削除しますか？\n\n付与済みメンバーからもRoleが失われます。Studio PolicyはDiscord側の実削除成功後に自動で整理されます。`,
    );
    if (!confirmed) return;

    setPendingAction('delete');
    setNotice(null);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/roles?roleId=${encodeURIComponent(selectedDeleteRole.id)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(
          describeStudioApiError(
            response.status,
            result,
            'Role削除の受付に失敗しました',
            'role-lifecycle',
          ),
        );
      }
      setNotice({
        kind: 'success',
        text: `${selectedDeleteRole.name} の削除を受け付けました。`,
      });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Role削除の受付に失敗しました。',
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Discord Role Lifecycle
          </p>
          <h2 className="mt-1 text-xl font-semibold">Roleの作成・削除・予約</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Discord
            Role本体を管理します。新規Roleは安全側で権限0・非メンション・非hoistとして作成され、必要なHerta権限は下のPolicy
            Editorで設定します。
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-background"
          aria-label="Roleと操作履歴を再読込"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          再読込
        </button>
      </div>

      {!botCanManageRoles ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <div>
              <p className="font-semibold">Herta BotのDiscord権限が不足しています</p>
              <p className="mt-1 leading-6">
                必要な権限は「ロールの管理」です。Discordのサーバー設定 → ロールでHerta
                Botへ権限を付与し、Herta BotのRoleを操作対象Roleより上に配置してください。
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-border bg-background p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold">新規Role</h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                即時作成、指定日時の作成、一定時間後の自動削除を組み合わせられます。
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium" htmlFor="role-lifecycle-name">
              Role名
            </label>
            <input
              id="role-lifecycle-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              disabled={!canEdit || pendingAction !== null}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder="例: Summer Event"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium" htmlFor="role-lifecycle-color">
                Role色
                <span className="mt-1 flex items-center gap-2">
                  <input
                    id="role-lifecycle-color"
                    type="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    disabled={!canEdit || pendingAction !== null}
                    className="h-10 w-14 rounded-lg border border-border bg-surface p-1"
                  />
                  <code className="text-xs text-muted">{color.toUpperCase()}</code>
                </span>
              </label>

              <label className="block text-sm font-medium" htmlFor="role-lifecycle-schedule-mode">
                作成タイミング
                <select
                  id="role-lifecycle-schedule-mode"
                  value={scheduleMode}
                  onChange={(event) => setScheduleMode(event.target.value as ScheduleMode)}
                  disabled={!canEdit || pendingAction !== null}
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-base"
                >
                  <option value="now">今すぐ</option>
                  <option value="scheduled">日時を指定</option>
                </select>
              </label>
            </div>

            {scheduleMode === 'scheduled' ? (
              <label className="block text-sm font-medium" htmlFor="role-lifecycle-scheduled-for">
                作成日時
                <span className="mt-1 flex w-full min-w-0 rounded-xl border border-border bg-surface px-3 py-2">
                  <input
                    id="role-lifecycle-scheduled-for"
                    type="datetime-local"
                    value={scheduledFor}
                    onChange={(event) => setScheduledFor(event.target.value)}
                    disabled={!canEdit || pendingAction !== null}
                    className="block w-full min-w-0 border-0 bg-transparent p-0 text-base"
                  />
                </span>
              </label>
            ) : null}

            <label className="flex items-start gap-3 rounded-xl border border-border p-3">
              <input
                type="checkbox"
                checked={temporary}
                onChange={(event) => setTemporary(event.target.checked)}
                disabled={!canEdit || pendingAction !== null}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-medium">期間限定 / 一時Role</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">
                  Role作成成功時刻を起点に期限を計算し、Workerが削除します。
                </span>
              </span>
            </label>

            {temporary ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <label className="block text-sm font-medium" htmlFor="role-lifecycle-duration">
                  有効期間
                  <input
                    id="role-lifecycle-duration"
                    type="number"
                    min="1"
                    step="1"
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                    disabled={!canEdit || pendingAction !== null}
                    className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-base"
                  />
                </label>
                <label className="block text-sm font-medium" htmlFor="role-lifecycle-duration-unit">
                  単位
                  <select
                    id="role-lifecycle-duration-unit"
                    value={durationUnit}
                    onChange={(event) => setDurationUnit(event.target.value as DurationUnit)}
                    disabled={!canEdit || pendingAction !== null}
                    className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-base"
                  >
                    <option value="minutes">分</option>
                    <option value="hours">時間</option>
                    <option value="days">日</option>
                  </select>
                </label>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void createRole()}
              disabled={createDisabled}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {scheduleMode === 'scheduled' ? (
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {pendingAction === 'create'
                ? '受付中…'
                : scheduleMode === 'scheduled'
                  ? '作成を予約'
                  : 'Roleを作成'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-red-500/20 bg-background p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-600">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold">既存Roleを削除</h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                root / Discord Managed / Bot
                hierarchy外のRoleは削除できません。削除は確認後に非同期実行されます。
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium" htmlFor="role-lifecycle-delete-role">
              削除対象Role
              <select
                id="role-lifecycle-delete-role"
                value={deleteRoleId}
                onChange={(event) => {
                  setDeleteRoleId(event.target.value);
                  setNotice(null);
                }}
                disabled={!canEdit || pendingAction !== null || roles.length === 0}
                className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-base"
              >
                {roles.map((role) => {
                  const reason = roleDeleteBlockReason(role, rootRoleId);
                  return (
                    <option key={role.id} value={role.id} disabled={reason !== null}>
                      {role.name}
                      {reason ? ` — ${deleteReasonLabel(reason)}` : ''}
                    </option>
                  );
                })}
              </select>
            </label>

            {selectedDeleteRole ? (
              <div className="rounded-xl border border-border bg-surface p-3 text-sm">
                <p className="font-medium">{selectedDeleteRole.name}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted">
                  {selectedDeleteRole.id}
                </p>
                <p className="mt-2 text-xs text-muted">
                  hierarchy #{selectedDeleteRole.position}
                  {deleteBlock ? ` · ${deleteReasonLabel(deleteBlock)}` : ' · 削除可能'}
                </p>
              </div>
            ) : (
              <p className="rounded-xl border border-border p-3 text-sm text-muted">
                削除可能なRoleがありません。
              </p>
            )}

            <button
              type="button"
              onClick={() => void deleteRole()}
              disabled={deleteDisabled}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {pendingAction === 'delete' ? '受付中…' : 'Discordから削除'}
            </button>

            <p className="text-xs leading-5 text-muted">
              削除成功後、該当RoleのStudio Policyも自動で整理されます。失敗時はAudit
              Logと操作履歴へ理由を残します。
            </p>
          </div>
        </div>
      </div>

      {notice ? (
        <p
          className={`rounded-xl border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'}`}
          role="status"
          aria-live="polite"
        >
          {notice.text}
        </p>
      ) : null}

      {!canEdit ? (
        <p className="rounded-xl border border-border bg-background p-3 text-sm text-muted">
          Role本体の変更はOWNER root Roleだけが実行できます。この画面では履歴のみ参照できます。
        </p>
      ) : null}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">直近のRole操作</h3>
            <p className="mt-1 text-xs text-muted">
              pending / processingがある間は5秒ごとに状態を更新します。
            </p>
          </div>
          {hasActiveOperations ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              実行待ちあり
            </span>
          ) : null}
        </div>

        {operations.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted">
            Role操作履歴はまだありません。
          </p>
        ) : (
          <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {operations.map((operation) => (
              <div
                key={operation.id}
                className="flex flex-col gap-2 bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {operation.operation === 'create' ? '作成' : '削除'} ·{' '}
                      {operation.roleName ?? operation.discordRoleId ?? 'Role'}
                    </span>
                    <OperationStatusBadge status={operation.status} />
                    {operation.expiresAfterSeconds !== null ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                        TTL {formatDuration(operation.expiresAfterSeconds)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    実行予定 {formatDateTime(operation.nextAttemptAt ?? operation.scheduledFor)} ·
                    試行 {operation.attemptCount}回
                  </p>
                  {operation.lastErrorName ? (
                    <p className="mt-1 break-all text-xs text-red-600">{operation.lastErrorName}</p>
                  ) : null}
                </div>
                <code className="shrink-0 text-[10px] text-muted">{operation.id.slice(0, 8)}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function OperationStatusBadge({ status }: { status: RoleLifecycleOperationView['status'] }) {
  const label =
    status === 'pending'
      ? '待機中'
      : status === 'processing'
        ? '実行中'
        : status === 'succeeded'
          ? '成功'
          : status === 'failed'
            ? '失敗'
            : 'キャンセル';
  const className =
    status === 'succeeded'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
      : status === 'failed'
        ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'
        : status === 'processing'
          ? 'border-primary/30 bg-primary/5 text-primary'
          : 'border-border bg-surface text-muted';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  );
}

function deleteReasonLabel(reason: 'root' | 'managed' | 'hierarchy'): string {
  return reason === 'root'
    ? 'OWNER root保護'
    : reason === 'managed'
      ? 'Discord Managed'
      : 'Bot hierarchy外';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}日`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}時間`;
  return `${Math.max(1, Math.round(seconds / 60))}分`;
}
