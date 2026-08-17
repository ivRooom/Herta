'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { STUDIO_ACCESS_POLICY_VERSION, type StudioAccessPolicy } from '@/lib/studio-access-policy';
import type { StudioRolePolicyRecord } from '@/lib/studio-role-policy-store';
import {
  getExplicitPermissionMode,
  pluginConfigFieldResource,
  pluginEnabledControlResource,
  setExplicitPermissionMode,
  type ExplicitPermissionMode,
} from '@/lib/studio-plugin-permissions';

export interface PluginPermissionDescriptor {
  id: string;
  name: string;
  fields: Array<{ key: string; label: string; description?: string }>;
}

interface DiscordRoleOption {
  id: string;
  name: string;
}

type ConfigMode = 'inherit' | 'readonly' | 'edit';
type OperationMode = 'inherit' | 'blocked' | 'allow';

export function PluginPermissionManager({
  guildId,
  roles,
  policies,
  plugins,
  rootRoleId,
  canEdit,
}: {
  guildId: string;
  roles: DiscordRoleOption[];
  policies: StudioRolePolicyRecord[];
  plugins: PluginPermissionDescriptor[];
  rootRoleId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const policyMap = useMemo(
    () => new Map(policies.map((policy) => [policy.discordRoleId, policy.policy])),
    [policies],
  );
  const firstRoleId = roles.find((role) => role.id !== rootRoleId)?.id ?? roles[0]?.id ?? '';
  const [selectedRoleId, setSelectedRoleId] = useState(firstRoleId);
  const [selectedPluginId, setSelectedPluginId] = useState(plugins[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, StudioAccessPolicy>>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const selectedRole = roles.find((role) => role.id === selectedRoleId);
  const selectedPlugin = plugins.find((plugin) => plugin.id === selectedPluginId);
  const policy = drafts[selectedRoleId] ?? policyMap.get(selectedRoleId) ?? emptyPolicy();
  const isRoot = selectedRoleId === rootRoleId;

  function updatePolicy(next: StudioAccessPolicy) {
    if (isRoot || !canEdit) return;
    setDrafts((current) => ({ ...current, [selectedRoleId]: next }));
    setNotice(null);
  }

  function configMode(fieldKey: string): ConfigMode {
    if (!selectedPlugin) return 'inherit';
    const resource = pluginConfigFieldResource(guildId, selectedPlugin.id, fieldKey);
    const explicit = getExplicitPermissionMode(policy, 'studio.settings.write', resource);
    if (explicit === 'allow') return 'edit';
    if (explicit === 'deny') return 'readonly';
    return 'inherit';
  }

  function setConfigMode(fieldKey: string, mode: ConfigMode) {
    if (!selectedPlugin) return;
    const resource = pluginConfigFieldResource(guildId, selectedPlugin.id, fieldKey);
    const explicit: ExplicitPermissionMode =
      mode === 'edit' ? 'allow' : mode === 'readonly' ? 'deny' : 'inherit';
    updatePolicy(setExplicitPermissionMode(policy, 'studio.settings.write', resource, explicit));
  }

  function operationMode(): OperationMode {
    if (!selectedPlugin) return 'inherit';
    const resource = pluginEnabledControlResource(guildId, selectedPlugin.id);
    const explicit = getExplicitPermissionMode(policy, 'studio.operation.execute', resource);
    if (explicit === 'allow') return 'allow';
    if (explicit === 'deny') return 'blocked';
    return 'inherit';
  }

  function setOperationMode(mode: OperationMode) {
    if (!selectedPlugin) return;
    const resource = pluginEnabledControlResource(guildId, selectedPlugin.id);
    const explicit: ExplicitPermissionMode =
      mode === 'allow' ? 'allow' : mode === 'blocked' ? 'deny' : 'inherit';
    updatePolicy(setExplicitPermissionMode(policy, 'studio.operation.execute', resource, explicit));
  }

  async function save() {
    if (!selectedRole || isRoot || !canEdit) return;
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
      if (!response.ok) {
        throw new Error(
          [result?.error, ...(result?.details ?? [])].filter(Boolean).join(' / ') ||
            'Plugin権限の保存に失敗しました',
        );
      }
      setNotice({ kind: 'success', text: `${selectedRole.name} のPlugin権限を保存しました。` });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Plugin権限の保存に失敗しました。',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-4">
        <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold">Discord Role</h2>
          <div className="mt-3 space-y-1" role="list" aria-label="Discord Role一覧">
            {roles.map((role) => {
              const active = role.id === selectedRoleId;
              const root = role.id === rootRoleId;
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => {
                    setSelectedRoleId(role.id);
                    setNotice(null);
                  }}
                  aria-pressed={active}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${active ? 'bg-primary/10 text-primary' : 'hover:bg-background'}`}
                >
                  <span className="truncate">{role.name}</span>
                  {root ? <LockKeyhole className="h-3.5 w-3.5" aria-label="root" /> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold">Plugin</h2>
          <div className="mt-3 space-y-1" role="list" aria-label="Plugin一覧">
            {plugins.map((plugin) => {
              const active = plugin.id === selectedPluginId;
              return (
                <button
                  key={plugin.id}
                  type="button"
                  onClick={() => {
                    setSelectedPluginId(plugin.id);
                    setNotice(null);
                  }}
                  aria-pressed={active}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm ${active ? 'bg-primary/10 text-primary' : 'hover:bg-background'}`}
                >
                  {plugin.name}
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="min-w-0 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              {selectedRole?.name ?? 'Role'}
            </p>
            <h1 className="mt-1 text-xl font-semibold">{selectedPlugin?.name ?? 'Pluginを選択'}</h1>
            <p className="mt-1 text-sm leading-6 text-muted">
              項目単位の編集権限は全体Policyより細かいDeny/Allowとして評価されます。Denyが常に優先されます。
            </p>
          </div>
        </div>

        {isRoot ? (
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <div className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              <p>OWNER root Roleは全Plugin・全項目を操作できます。個別制限は設定できません。</p>
            </div>
          </div>
        ) : selectedPlugin ? (
          <div className="mt-6 space-y-6">
            <div className="rounded-xl border border-border bg-background p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Plugin有効 / 無効</h2>
                  <p className="mt-1 text-xs text-muted">
                    Pluginそのものを起動・停止する操作権限です。
                  </p>
                </div>
                <PermissionSelect
                  value={operationMode()}
                  onChange={(value) => setOperationMode(value as OperationMode)}
                  options={[
                    ['inherit', '継承'],
                    ['blocked', '操作不可'],
                    ['allow', '操作可'],
                  ]}
                  disabled={!canEdit || pending}
                  label="Plugin有効無効の操作権限"
                />
              </div>
            </div>

            <div>
              <div className="mb-3">
                <h2 className="text-sm font-semibold">設定項目</h2>
                <p className="mt-1 text-xs leading-5 text-muted">
                  「閲覧のみ」は <code>studio.settings.write</code>{' '}
                  を明示Denyします。「編集可」は項目Resourceへ明示Allowします。
                </p>
              </div>
              {selectedPlugin.fields.length > 0 ? (
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {selectedPlugin.fields.map((field) => (
                    <div
                      key={field.key}
                      className="flex flex-col gap-3 bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{field.label}</p>
                        <code className="mt-1 block break-all text-[11px] text-muted">
                          {field.key}
                        </code>
                        {field.description ? (
                          <p className="mt-1 text-xs leading-5 text-muted">{field.description}</p>
                        ) : null}
                      </div>
                      <PermissionSelect
                        value={configMode(field.key)}
                        onChange={(value) => setConfigMode(field.key, value as ConfigMode)}
                        options={[
                          ['inherit', '継承'],
                          ['readonly', '閲覧のみ'],
                          ['edit', '編集可'],
                        ]}
                        disabled={!canEdit || pending}
                        label={`${field.label} の編集権限`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
                  このPluginにはStudioから編集できる設定項目がありません。
                </div>
              )}
            </div>
          </div>
        ) : null}

        {notice ? (
          <p
            className={`mt-5 rounded-xl border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}
            role="status"
          >
            {notice.text}
          </p>
        ) : null}

        {!isRoot ? (
          <div className="mt-6 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canEdit || pending || !selectedRole || !selectedPlugin}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {pending ? '保存中…' : 'Plugin権限を保存'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PermissionSelect({
  value,
  onChange,
  options,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  disabled: boolean;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label={label}
      className="min-w-36 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

function emptyPolicy(): StudioAccessPolicy {
  return { Version: STUDIO_ACCESS_POLICY_VERSION, Statement: [] };
}
