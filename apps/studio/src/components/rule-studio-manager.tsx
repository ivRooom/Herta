'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock3, Plus, Save, ShieldAlert, Trash2, UserPlus } from 'lucide-react';
import type {
  RuleStudioActionType,
  RuleStudioTriggerType,
  RuleStudioView,
} from '@/lib/rule-studio';

interface RoleOption {
  id: string;
  name: string;
}

type Notice = { kind: 'success' | 'error'; text: string } | null;

const DEFAULT_DRAFT = {
  name: '',
  description: '',
  enabled: true,
  priority: 0,
  triggerType: 'schedule.minute' as RuleStudioTriggerType,
  everyMinutes: 60,
  offsetMinutes: 0,
  conditionHour: null as number | null,
  actionType: 'discord.role.create' as RuleStudioActionType,
  roleName: '',
  roleColor: 0x5865f2,
  expiresAfterSeconds: 3600,
  roleId: '',
  cooldownMs: 0,
  maxExecutions: null as number | null,
};

export function RuleStudioManager({
  guildId,
  rules,
  deleteRoleOptions,
  canEdit,
  unsupportedCount,
}: {
  guildId: string;
  rules: RuleStudioView[];
  deleteRoleOptions: RoleOption[];
  canEdit: boolean;
  unsupportedCount: number;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(rules[0]?.id ?? 'new');
  const selected = rules.find((rule) => rule.id === selectedId) ?? null;
  const [draft, setDraft] = useState(() => selected ?? DEFAULT_DRAFT);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const lastSync = useRef<string | null>(null);

  useEffect(() => {
    const next = rules.find((rule) => rule.id === selectedId) ?? null;
    const key = next ? `${next.id}:${next.updatedAt}` : selectedId === 'new' ? 'new' : null;
    if (!key || lastSync.current === key) return;
    lastSync.current = key;
    setDraft(next ?? DEFAULT_DRAFT);
  }, [rules, selectedId]);

  function patch<K extends keyof typeof DEFAULT_DRAFT>(key: K, value: (typeof DEFAULT_DRAFT)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function changeTriggerType(triggerType: RuleStudioTriggerType) {
    setDraft((current) => ({
      ...current,
      triggerType,
      conditionHour: triggerType === 'schedule.minute' ? current.conditionHour : null,
    }));
    setNotice(null);
  }

  function startNew() {
    setSelectedId('new');
    lastSync.current = 'new';
    setDraft(DEFAULT_DRAFT);
    setNotice(null);
  }

  async function save() {
    if (!canEdit || pending || !draft.name.trim()) return;
    setPending(true);
    setNotice(null);
    try {
      const isNew = selectedId === 'new';
      const response = await fetch(`/api/guilds/${guildId}/rules`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          ...(isNew ? {} : { ruleId: selectedId, expectedUpdatedAt: selected?.updatedAt }),
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        details?: string[];
        rule?: RuleStudioView | null;
      } | null;
      if (!response.ok) {
        throw new Error(
          [result?.error, ...(result?.details ?? [])].filter(Boolean).join('\n') ||
            'Ruleを保存できませんでした',
        );
      }
      if (isNew && result?.rule?.id) setSelectedId(result.rule.id);
      setNotice({ kind: 'success', text: isNew ? 'Ruleを作成しました。' : 'Ruleを更新しました。' });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Ruleを保存できませんでした。',
      });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!canEdit || pending || !selected) return;
    if (!window.confirm(`Rule「${selected.name}」を削除しますか？実行履歴も削除されます。`)) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/rules?ruleId=${encodeURIComponent(selected.id)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || 'Ruleを削除できませんでした');
      setSelectedId('new');
      lastSync.current = 'new';
      setDraft(DEFAULT_DRAFT);
      setNotice({ kind: 'success', text: 'Ruleを削除しました。' });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Ruleを削除できませんでした。',
      });
    } finally {
      setPending(false);
    }
  }

  const permissionHint = 'この操作には OWNER root Role が必要です。';

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Automation</p>
          <h2 className="mt-1 text-xl font-semibold">Rule Studio</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Production runtimeで対応済みのSchedule / Member joined TriggerとDiscord Role
            ActionをGUIで設定します。
          </p>
        </div>
        <PermissionButton
          allowed={canEdit}
          disabled={pending}
          hint={permissionHint}
          onClick={startNew}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> 新規Rule
        </PermissionButton>
      </div>

      {!canEdit ? (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <p>
              閲覧専用です。Ruleの作成・変更・削除には OWNER root Role
              が必要です。操作項目はグレーアウトしています。
            </p>
          </div>
        </div>
      ) : null}

      {unsupportedCount > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          {unsupportedCount}件のRuleはv1
          Editorの対応範囲外です。Runtimeでは既存定義のまま維持され、ここからは変更しません。
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-background p-3">
          <nav className="space-y-1" aria-label="Rule一覧">
            {rules.map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => {
                  setSelectedId(rule.id);
                  setNotice(null);
                }}
                aria-pressed={selectedId === rule.id}
                className={`w-full rounded-lg px-3 py-2 text-left ${selectedId === rule.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface'}`}
              >
                <span className="block truncate text-sm font-semibold">{rule.name}</span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  <span>{rule.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span>実行 {rule.executionCount}</span>
                </span>
              </button>
            ))}
            {rules.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted">Ruleはまだありません。</p>
            ) : null}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <fieldset
            disabled={!canEdit || pending}
            className="space-y-5 disabled:opacity-60"
            title={!canEdit ? permissionHint : undefined}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rule名">
                <input
                  value={draft.name}
                  onChange={(event) => patch('name', event.target.value)}
                  maxLength={100}
                  className={inputClass}
                />
              </Field>
              <Field label="説明">
                <input
                  value={draft.description}
                  onChange={(event) => patch('description', event.target.value)}
                  maxLength={500}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => patch('enabled', event.target.checked)}
                />
                Ruleを有効化
              </label>
              <Field label="Priority">
                <input
                  type="number"
                  min={-10000}
                  max={10000}
                  value={draft.priority}
                  onChange={(event) => patch('priority', Number(event.target.value))}
                  className={inputClass}
                />
              </Field>
              <Field label="Cooldown (ms)">
                <input
                  type="number"
                  min={0}
                  value={draft.cooldownMs}
                  onChange={(event) => patch('cooldownMs', Number(event.target.value))}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center gap-2">
                {draft.triggerType === 'schedule.minute' ? (
                  <Clock3 className="h-4 w-4 text-primary" aria-hidden="true" />
                ) : (
                  <UserPlus className="h-4 w-4 text-primary" aria-hidden="true" />
                )}
                <h3 className="font-semibold">Trigger</h3>
              </div>
              <div className="mt-4 max-w-sm">
                <Field label="Trigger種別">
                  <select
                    value={draft.triggerType}
                    onChange={(event) =>
                      changeTriggerType(event.target.value as RuleStudioTriggerType)
                    }
                    className={inputClass}
                  >
                    <option value="schedule.minute">Schedule</option>
                    <option value="member.joined">Member joined</option>
                  </select>
                </Field>
              </div>
              {draft.triggerType === 'schedule.minute' ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <Field label="実行間隔（分）">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={draft.everyMinutes}
                      onChange={(event) => patch('everyMinutes', Number(event.target.value))}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Offset（分）">
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, draft.everyMinutes - 1)}
                      value={draft.offsetMinutes}
                      onChange={(event) => patch('offsetMinutes', Number(event.target.value))}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="UTC時刻条件（任意）">
                    <select
                      value={draft.conditionHour === null ? '' : String(draft.conditionHour)}
                      onChange={(event) =>
                        patch(
                          'conditionHour',
                          event.target.value === '' ? null : Number(event.target.value),
                        )
                      }
                      className={inputClass}
                    >
                      <option value="">指定なし</option>
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {hour}:00 UTC
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-blue-500/25 bg-blue-500/5 p-3 text-sm leading-6 text-muted">
                  <p className="font-semibold text-foreground">
                    新しいメンバーがGuildへ参加したときに実行します。
                  </p>
                  <p className="mt-1">
                    BotでGuild Members Intentが有効な環境で動作します。Message Content
                    Intentは不要です。
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-background p-4">
              <h3 className="font-semibold">Action</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Action種別">
                  <select
                    value={draft.actionType}
                    onChange={(event) =>
                      patch('actionType', event.target.value as RuleStudioActionType)
                    }
                    className={inputClass}
                  >
                    <option value="discord.role.create">Roleを作成</option>
                    <option value="discord.role.create-temporary">一時Roleを作成</option>
                    <option value="discord.role.delete">Roleを削除</option>
                  </select>
                </Field>
                {draft.actionType === 'discord.role.delete' ? (
                  <Field label="削除対象Role">
                    <select
                      value={draft.roleId}
                      onChange={(event) => patch('roleId', event.target.value)}
                      className={inputClass}
                    >
                      <option value="">選択してください</option>
                      {deleteRoleOptions.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="作成Role名">
                    <input
                      value={draft.roleName}
                      onChange={(event) => patch('roleName', event.target.value)}
                      maxLength={100}
                      className={inputClass}
                    />
                  </Field>
                )}
              </div>

              {draft.actionType !== 'discord.role.delete' ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Role色">
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={numberToHex(draft.roleColor)}
                        onChange={(event) => patch('roleColor', hexToNumber(event.target.value))}
                        className="h-10 w-14 rounded-lg border border-border bg-surface p-1"
                      />
                      <code className="text-xs text-muted">
                        {numberToHex(draft.roleColor).toUpperCase()}
                      </code>
                    </div>
                  </Field>
                  {draft.actionType === 'discord.role.create-temporary' ? (
                    <Field label="有効期間（秒）">
                      <input
                        type="number"
                        min={60}
                        max={31536000}
                        value={draft.expiresAfterSeconds}
                        onChange={(event) =>
                          patch('expiresAfterSeconds', Number(event.target.value))
                        }
                        className={inputClass}
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}
            </div>

            <Field label="最大実行回数（任意）">
              <input
                type="number"
                min={1}
                value={draft.maxExecutions ?? ''}
                onChange={(event) =>
                  patch(
                    'maxExecutions',
                    event.target.value === '' ? null : Number(event.target.value),
                  )
                }
                placeholder="無制限"
                className={`${inputClass} max-w-xs`}
              />
            </Field>
          </fieldset>

          {notice ? (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`whitespace-pre-line rounded-xl border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'}`}
            >
              {notice.text}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <PermissionButton
              allowed={canEdit}
              disabled={pending || !draft.name.trim()}
              hint={permissionHint}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              <Save className="h-4 w-4" aria-hidden="true" /> {selected ? '更新' : '作成'}
            </PermissionButton>
            {selected ? (
              <PermissionButton
                allowed={canEdit}
                disabled={pending}
                hint={permissionHint}
                onClick={() => void remove()}
                className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Rule削除
              </PermissionButton>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function PermissionButton({
  allowed,
  disabled,
  hint,
  className,
  onClick,
  children,
}: {
  allowed: boolean;
  disabled: boolean;
  hint: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex"
      title={!allowed ? hint : undefined}
      tabIndex={!allowed ? 0 : undefined}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!allowed || disabled}
        aria-disabled={!allowed || disabled}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-45`}
      >
        {children}
      </button>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <span className="mt-2 block font-normal">{children}</span>
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed';

function numberToHex(value: number): string {
  const safe = Number.isInteger(value) ? Math.max(0, Math.min(0xffffff, value)) : 0;
  return `#${safe.toString(16).padStart(6, '0')}`;
}

function hexToNumber(value: string): number {
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}
