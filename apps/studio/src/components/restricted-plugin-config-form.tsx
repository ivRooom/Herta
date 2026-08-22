'use client';

import { useMemo, useState } from 'react';
import {
  listConcretePluginConfigValues,
  pluginConfigPermissionFields,
  type PluginConfigPathSegment,
} from '@/lib/plugin-config-paths';
import type { PluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import { topLevelConfigFields } from '@/lib/studio-policy-resources';

const SAVE_TIMEOUT_MS = 15_000;

type PluginUpdateResponse = {
  error?: unknown;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

interface RestrictedEditorEntry {
  id: string;
  label: string;
  description: string;
  path: PluginConfigPathSegment[];
  permissionPath: string;
  canEdit: boolean;
  rows: number;
}

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
  const entries = useMemo(
    () => buildEditorEntries(initialConfig, schema, configAccess),
    [configAccess, initialConfig, schema],
  );
  const [enabled, setEnabled] = useState(initialEnabled);
  const [savedEnabled, setSavedEnabled] = useState(initialEnabled);
  const [values, setValues] = useState<Record<string, string>>(() =>
    toEditorValues(entries, initialConfig),
  );
  const [savedValues, setSavedValues] = useState<Record<string, string>>(() =>
    toEditorValues(entries, initialConfig),
  );
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');

  const dirtyEntries = entries.filter(
    (entry) => entry.canEdit && (values[entry.id] ?? '') !== (savedValues[entry.id] ?? ''),
  );
  const enabledDirty = enabled !== savedEnabled;
  const dirty = enabledDirty || dirtyEntries.length > 0;

  async function save() {
    if (!dirty || pending) return;
    const configPathPatch: Array<{ path: PluginConfigPathSegment[]; value: unknown }> = [];
    const removeConfigPaths: PluginConfigPathSegment[][] = [];
    try {
      for (const entry of dirtyEntries) {
        const raw = (values[entry.id] ?? '').trim();
        if (!raw) {
          removeConfigPaths.push(entry.path);
        } else {
          configPathPatch.push({ path: entry.path, value: JSON.parse(raw) as unknown });
        }
      }
    } catch {
      setStatus(
        'JSON値の形式が不正な設定項目があります。文字列は "value" のように入力してください。',
      );
      return;
    }

    setPending(true);
    setStatus('保存中…');
    try {
      const payload: {
        enabled?: boolean;
        configPathPatch?: Array<{ path: PluginConfigPathSegment[]; value: unknown }>;
        removeConfigPaths?: PluginConfigPathSegment[][];
      } = {};
      if (enabledDirty) payload.enabled = enabled;
      if (configPathPatch.length > 0) payload.configPathPatch = configPathPatch;
      if (removeConfigPaths.length > 0) payload.removeConfigPaths = removeConfigPaths;

      const response = await fetch(`/api/guilds/${guildId}/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as PluginUpdateResponse | null;
      if (!response.ok) {
        throw new Error(
          typeof result?.error === 'string' ? result.error : '設定の保存に失敗しました',
        );
      }

      const nextConfig = isRecord(result?.config) ? result.config : initialConfig;
      const nextValues = toEditorValues(entries, nextConfig);
      const nextEnabled = typeof result?.enabled === 'boolean' ? result.enabled : enabled;
      setValues(nextValues);
      setSavedValues(nextValues);
      setEnabled(nextEnabled);
      setSavedEnabled(nextEnabled);
      setStatus('許可された設定パスを保存しました');
    } catch (error) {
      setStatus(
        isTimeoutError(error)
          ? '設定の保存がタイムアウトしました。通信状態を確認して再実行してください。'
          : error instanceof Error
            ? error.message
            : '設定の保存に失敗しました',
      );
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
          <h2 className="mt-3 text-xl font-semibold">許可された設定パス</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            閲覧許可された値だけをClientへ読み込みます。Object /
            Array内も設定パス単位で分離し、編集は `studio.settings.write`
            が許可された値だけ送信します。非表示の兄弟設定は上書きしません。
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
        {entries.map((entry) => (
          <label key={entry.id} className="block rounded-xl border border-border bg-background p-4">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{entry.label}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  entry.canEdit
                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                    : 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                }`}
              >
                {entry.canEdit ? '編集可能' : '閲覧のみ'}
              </span>
            </span>
            <code className="mt-1 block break-all text-[11px] text-muted">
              {formatConcretePath(entry.path)} · IAM: {entry.permissionPath}
            </code>
            {entry.description ? (
              <span className="mt-2 block text-xs leading-5 text-muted">{entry.description}</span>
            ) : null}
            <textarea
              value={values[entry.id] ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, [entry.id]: event.target.value }))
              }
              readOnly={!entry.canEdit}
              aria-readonly={!entry.canEdit}
              rows={entry.rows}
              spellCheck={false}
              className="mt-3 w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:cursor-default read-only:opacity-70"
            />
            {entry.canEdit ? (
              <span className="mt-1 block text-[11px] text-muted">
                JSON値として入力します。空欄はこの設定パスの削除として扱い、最終Schema
                validationと権限確認はserver側で再実行されます。
              </span>
            ) : null}
          </label>
        ))}
        {entries.length === 0 ? (
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

function buildEditorEntries(
  config: Record<string, unknown>,
  schema: Record<string, unknown>,
  access: PluginConfigStudioAccess,
): RestrictedEditorEntry[] {
  const readable = new Set(access.readableConfigPaths);
  const editable = new Set(access.editableConfigPaths);
  const wholeEditable = new Set(access.editableFieldKeys);
  const permissionFields = pluginConfigPermissionFields(schema);
  const permissionFieldMap = new Map(permissionFields.map((field) => [field.path, field]));
  const schemaPathsByTopLevel = new Map<string, string[]>();
  for (const field of permissionFields) {
    const paths = schemaPathsByTopLevel.get(field.topLevelKey) ?? [];
    paths.push(field.path);
    schemaPathsByTopLevel.set(field.topLevelKey, paths);
  }
  const concreteValues = listConcretePluginConfigValues(config, schema);
  const concreteByTopLevel = new Map<string, typeof concreteValues>();
  for (const concrete of concreteValues) {
    const topLevel = typeof concrete.path[0] === 'string' ? concrete.path[0] : '';
    if (!topLevel) continue;
    const entries = concreteByTopLevel.get(topLevel) ?? [];
    entries.push(concrete);
    concreteByTopLevel.set(topLevel, entries);
  }

  const output: RestrictedEditorEntry[] = [];
  for (const field of topLevelConfigFields(schema)) {
    const schemaPaths = schemaPathsByTopLevel.get(field.key) ?? [field.key];
    const readablePaths = schemaPaths.filter((path) => readable.has(path));
    if (readablePaths.length === 0) continue;

    const canUseWholeField =
      wholeEditable.has(field.key) && schemaPaths.every((path) => readable.has(path));
    const concrete = concreteByTopLevel.get(field.key) ?? [];
    if (canUseWholeField || concrete.length === 0) {
      output.push({
        id: pathId([field.key]),
        label: field.label,
        description: field.description,
        path: [field.key],
        permissionPath: field.key,
        canEdit: canUseWholeField,
        rows: rowsForValue(config[field.key]),
      });
      continue;
    }

    for (const entry of concrete) {
      if (!readable.has(entry.permissionPath)) continue;
      const metadata = permissionFieldMap.get(entry.permissionPath);
      output.push({
        id: pathId(entry.path),
        label: entry.label,
        description: metadata?.description ?? '',
        path: [...entry.path],
        permissionPath: entry.permissionPath,
        canEdit: editable.has(entry.permissionPath),
        rows: rowsForValue(entry.value),
      });
    }
  }
  return output;
}

function toEditorValues(
  entries: readonly RestrictedEditorEntry[],
  config: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    entries.map((entry) => {
      const value = valueAtPath(config, entry.path);
      return [entry.id, value === undefined ? '' : (JSON.stringify(value, null, 2) ?? '')];
    }),
  );
}

function valueAtPath(
  root: Record<string, unknown>,
  path: readonly PluginConfigPathSegment[],
): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) return undefined;
      current = current[segment];
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function pathId(path: readonly PluginConfigPathSegment[]): string {
  return JSON.stringify(path);
}

function formatConcretePath(path: readonly PluginConfigPathSegment[]): string {
  let output = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      output += `[${segment}]`;
    } else {
      output += output ? `.${segment}` : segment;
    }
  }
  return output;
}

function rowsForValue(value: unknown): number {
  return Array.isArray(value) || isRecord(value) ? 5 : 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
