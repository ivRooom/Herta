'use client';

import { useMemo, useState } from 'react';
import type { PluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import { topLevelConfigFields } from '@/lib/studio-policy-resources';

type PluginUpdateResponse = {
  error?: unknown;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

export function RestrictedPluginConfigForm({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  schema,
  configAccess,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  schema: Record<string, unknown>;
  configAccess: PluginConfigStudioAccess;
}) {
  const readable = useMemo(
    () => new Set(configAccess.readableFieldKeys),
    [configAccess.readableFieldKeys],
  );
  const editable = useMemo(
    () => new Set(configAccess.editableFieldKeys),
    [configAccess.editableFieldKeys],
  );
  const fields = useMemo(
    () => topLevelConfigFields(schema).filter((field) => readable.has(field.key)),
    [readable, schema],
  );
  const [enabled, setEnabled] = useState(initialEnabled);
  const [savedEnabled, setSavedEnabled] = useState(initialEnabled);
  const [values, setValues] = useState<Record<string, string>>(() => toEditorValues(initialConfig));
  const [savedValues, setSavedValues] = useState<Record<string, string>>(() =>
    toEditorValues(initialConfig),
  );
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');

  const dirtyFieldKeys = fields
    .filter((field) => editable.has(field.key))
    .map((field) => field.key)
    .filter((key) => (values[key] ?? '') !== (savedValues[key] ?? ''));
  const enabledDirty = enabled !== savedEnabled;
  const dirty = enabledDirty || dirtyFieldKeys.length > 0;

  async function save() {
    if (!dirty || pending) return;
    const configPatch: Record<string, unknown> = {};
    const removeConfigFields: string[] = [];
    try {
      for (const key of dirtyFieldKeys) {
        const raw = (values[key] ?? '').trim();
        if (!raw) {
          removeConfigFields.push(key);
        } else {
          configPatch[key] = JSON.parse(raw) as unknown;
        }
      }
    } catch {
      setStatus('JSON値の形式が不正な設定項目があります。文字列は "value" のように入力してください。');
      return;
    }

    setPending(true);
    setStatus('保存中…');
    try {
      const payload: {
        enabled?: boolean;
        configPatch?: Record<string, unknown>;
        removeConfigFields?: string[];
      } = {};
      if (enabledDirty) payload.enabled = enabled;
      if (Object.keys(configPatch).length > 0) payload.configPatch = configPatch;
      if (removeConfigFields.length > 0) payload.removeConfigFields = removeConfigFields;

      const response = await fetch(`/api/guilds/${guildId}/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as PluginUpdateResponse | null;
      if (!response.ok) {
        throw new Error(typeof result?.error === 'string' ? result.error : '設定の保存に失敗しました');
      }

      const nextConfig = isRecord(result?.config) ? result.config : initialConfig;
      const nextValues = toEditorValues(nextConfig);
      const nextEnabled = typeof result?.enabled === 'boolean' ? result.enabled : enabled;
      setValues(nextValues);
      setSavedValues(nextValues);
      setEnabled(nextEnabled);
      setSavedEnabled(nextEnabled);
      setStatus('許可された設定項目を保存しました');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '設定の保存に失敗しました');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-amber-400/20 bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300">
            IAM制限モード
          </span>
          <h2 className="mt-3 text-xl font-semibold">許可された設定項目</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            閲覧許可された値だけをClientへ読み込みます。編集はさらに `studio.settings.write` が許可された項目だけ可能です。見えない設定は部分更新から除外され、上書きされません。
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm">
          <span>
            <span className="block font-semibold">Plugin</span>
            <span className="text-xs text-muted">{enabled ? '有効' : '無効'}</span>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!configAccess.canToggleEnabled || pending}
            onChange={(event) => setEnabled(event.target.checked)}
            aria-label="Pluginの有効状態"
            className="h-4 w-4 accent-primary"
          />
        </label>
      </div>

      <div className="grid gap-4">
        {fields.map((field) => {
          const canEdit = editable.has(field.key);
          return (
            <label
              key={field.key}
              className="block rounded-xl border border-border bg-background p-4"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{field.label}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    canEdit
                      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                      : 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                  }`}
                >
                  {canEdit ? '編集可能' : '閲覧のみ'}
                </span>
              </span>
              <code className="mt-1 block break-all text-[11px] text-muted">{field.key}</code>
              {field.description ? (
                <span className="mt-2 block text-xs leading-5 text-muted">{field.description}</span>
              ) : null}
              <textarea
                value={values[field.key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
                readOnly={!canEdit}
                aria-readonly={!canEdit}
                rows={Array.isArray(initialConfig[field.key]) || isRecord(initialConfig[field.key]) ? 5 : 2}
                spellCheck={false}
                className="mt-3 w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:cursor-default read-only:opacity-70"
              />
              {canEdit ? (
                <span className="mt-1 block text-[11px] text-muted">
                  JSON値として入力します。空欄で設定項目を削除し、最終的なSchema validationはserver側で実行されます。
                </span>
              ) : null}
            </label>
          );
        })}
        {fields.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            このPluginで閲覧を許可された設定項目はありません。
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted" aria-live="polite">
          {status || (dirty ? '未保存の変更があります' : '設定は保存済みです')}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? '保存中…' : '許可された変更を保存'}
        </button>
      </div>
    </section>
  );
}

function toEditorValues(config: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      value === undefined ? '' : JSON.stringify(value, null, 2),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
