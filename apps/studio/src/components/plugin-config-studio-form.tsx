'use client';

import { useMemo, useState } from 'react';

import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import type { PluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import {
  DiscordChannelPicker,
  DiscordEmojiPicker,
  DiscordRolePicker,
} from './discord-entity-picker';
import { DiscordMessageTargetPicker } from './discord-message-target-picker';
import { DiscordUserPicker } from './discord-user-picker';

import {
  getSchemaBranchState,
  resolveSchemaForValue,
  schemaMatchesValue,
  selectSchemaBranch,
  type SchemaBranchState,
} from '../lib/plugin-config-schema-branches';
import {
  fieldMatchesSearch,
  formatStudioValidationPath,
  makeDefaultValue,
  moveArrayItem,
  normalizeConfigForStudio,
  parseConfigJson,
  removeConfigValue,
  schemaAllowsNull,
  schemaPrimaryType,
  stringifyConfig,
  updateConfigValue,
  type ConfigObject,
  type JsonSchema,
} from '../lib/plugin-config-studio';
import {
  mergeValidationIssues,
  readApiValidationIssues,
  validateStudioDraft,
  validationIssueCountUnderPath,
  validationIssuesAtPath,
  type ConfigValidationIssue,
} from '../lib/plugin-config-validation-ui';

type PluginUpdateResponse = {
  error?: unknown;
  details?: unknown;
  issues?: unknown;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

type Path = Array<string | number>;

type ComposedJsonSchema = JsonSchema & {
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;
};

export function PluginConfigStudioForm({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  schema,
  discordOptions,
  configAccess,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  schema: Record<string, unknown>;
  discordOptions?: GuildConfigurationOptions | null;
  configAccess: PluginConfigStudioAccess;
}) {
  const configSchema = schema as JsonSchema;
  const initialNormalized = useMemo(
    () => normalizeConfigForStudio(configSchema, initialConfig),
    [configSchema, initialConfig],
  );
  const [enabled, setEnabled] = useState(initialEnabled);
  const [config, setConfig] = useState<ConfigObject>(initialNormalized);
  const [savedConfig, setSavedConfig] = useState<ConfigObject>(initialNormalized);
  const [savedEnabled, setSavedEnabled] = useState(initialEnabled);
  const [jsonText, setJsonText] = useState(() => stringifyConfig(initialNormalized));
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverIssues, setServerIssues] = useState<ConfigValidationIssue[]>([]);

  const editableFieldKeySet = useMemo(
    () => new Set(configAccess.editableFieldKeys),
    [configAccess.editableFieldKeys],
  );
  const topLevelFieldKeys = Object.keys(configSchema.properties ?? {});
  const allConfigFieldsEditable = topLevelFieldKeys.every((key) => editableFieldKeySet.has(key));
  const jsonReadOnly = !allConfigFieldsEditable;
  const hasPermissionRestrictions = !configAccess.canToggleEnabled || jsonReadOnly;
  const savedConfigText = stringifyConfig(savedConfig);
  const enabledDirty = enabled !== savedEnabled;
  const configDirty =
    mode === 'json' ? jsonText !== savedConfigText : stringifyConfig(config) !== savedConfigText;
  const dirty = enabledDirty || configDirty;
  const validationState = useMemo(
    () => validateStudioDraft(configSchema, mode, config, jsonText),
    [configSchema, config, jsonText, mode],
  );
  const validationIssues = useMemo(
    () => mergeValidationIssues(validationState.issues, serverIssues),
    [serverIssues, validationState.issues],
  );
  const validationErrorCount = validationIssues.length + (validationState.jsonError ? 1 : 0);
  const hasValidationErrors = validationErrorCount > 0;
  const effectiveConfigSchema = useMemo(
    () => resolveSchemaForValue(configSchema, config),
    [config, configSchema],
  );
  const rootBranchState = useMemo(
    () => getSchemaBranchState(configSchema, config),
    [config, configSchema],
  );
  const rootDiscriminatorKey = getBranchDiscriminatorKey(rootBranchState);
  const properties = effectiveConfigSchema.properties ?? {};
  const visibleEntries = Object.entries(properties).filter(
    ([key, propertySchema]) =>
      key !== rootDiscriminatorKey && fieldMatchesSearch(key, propertySchema, query),
  );

  function clearServerIssues() {
    setServerIssues([]);
  }

  function markChanged(message = '未保存の変更があります') {
    clearServerIssues();
    setStatus(message);
  }

  function update(path: Path, nextValue: unknown) {
    setConfig((current) => updateConfigValue(current, path, nextValue) as ConfigObject);
    markChanged();
  }

  function remove(path: Path) {
    setConfig((current) => removeConfigValue(current, path) as ConfigObject);
    markChanged();
  }

  function selectRootBranch(index: number) {
    if (!allConfigFieldsEditable) return;
    const next = selectSchemaBranch(configSchema, config, index);
    if (!isObject(next)) return;
    setConfig(next);
    markChanged('設定タイプを切り替えました。保存するまで反映されません');
  }

  function enterJsonMode() {
    setJsonText(stringifyConfig(config));
    clearServerIssues();
    setStatus('');
    setMode('json');
  }

  function applyJsonToVisual() {
    if (jsonReadOnly) {
      setMode('visual');
      clearServerIssues();
      setStatus('Advanced JSONはRole権限により閲覧専用です');
      return;
    }
    try {
      const parsed = parseConfigJson(jsonText);
      const normalized = normalizeConfigForStudio(configSchema, parsed);
      const nextValidation = validateStudioDraft(configSchema, 'visual', normalized, '');
      setConfig(normalized);
      setJsonText(stringifyConfig(normalized));
      clearServerIssues();
      setStatus(
        nextValidation.issues.length > 0
          ? `JSONをGUIへ反映しました。入力エラーが${nextValidation.issues.length}件あります`
          : 'JSONをGUIへ反映しました',
      );
      setMode('visual');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'JSONの形式が不正です');
    }
  }

  function resetToDefaults() {
    if (!allConfigFieldsEditable) {
      setStatus('閲覧のみの項目があるため、一括リセットは利用できません');
      return;
    }
    const next = normalizeConfigForStudio(configSchema, {});
    setConfig(next);
    setJsonText(stringifyConfig(next));
    clearServerIssues();
    setStatus('Schemaの初期値へ戻しました。保存するまで反映されません');
  }

  function undoUnsavedChanges() {
    setConfig(savedConfig);
    setEnabled(savedEnabled);
    setJsonText(stringifyConfig(savedConfig));
    clearServerIssues();
    setStatus('未保存の変更を破棄しました');
  }

  function jumpToIssue(path: string) {
    if (path === '$') return;

    if (mode === 'json' && validationState.config) {
      setConfig(validationState.config);
      setMode('visual');
    }

    setQuery('');
    window.setTimeout(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-config-path]')).find(
        (element) => element.dataset.configPath === path,
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    }, 0);
  }

  async function save() {
    const draft = validateStudioDraft(configSchema, mode, config, jsonText);
    if (draft.jsonError) {
      clearServerIssues();
      setStatus(draft.jsonError);
      return;
    }
    if (draft.issues.length > 0 || !draft.config) {
      clearServerIssues();
      setStatus(`入力エラーが${draft.issues.length}件あります。修正してから保存してください`);
      return;
    }

    if (!dirty) {
      clearServerIssues();
      setStatus('保存する変更はありません');
      return;
    }

    setSaving(true);
    setStatus('保存中…');
    try {
      const payloadConfig = draft.config;
      const payload: { enabled?: boolean; config?: ConfigObject } = {};
      if (enabledDirty) payload.enabled = enabled;
      if (configDirty) payload.config = payloadConfig;
      const response = await fetch(`/api/guilds/${guildId}/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        const apiIssues = readApiValidationIssues(result);
        if (apiIssues.length > 0) {
          setServerIssues(apiIssues);
          setStatus(`サーバー検証で入力エラーが${apiIssues.length}件見つかりました`);
          return;
        }
        throw new Error(formatApiError(result, '保存に失敗しました'));
      }

      const normalized = normalizeConfigForStudio(
        configSchema,
        result?.config ?? (configDirty ? payloadConfig : savedConfig),
      );
      const nextEnabled = typeof result?.enabled === 'boolean' ? result.enabled : enabled;
      setConfig(normalized);
      setSavedConfig(normalized);
      setEnabled(nextEnabled);
      setSavedEnabled(nextEnabled);
      setJsonText(stringifyConfig(normalized));
      clearServerIssues();
      setStatus('保存しました');
    } catch (error) {
      setStatus(
        error instanceof SyntaxError
          ? 'JSONの形式が不正です'
          : error instanceof Error
            ? error.message
            : '保存に失敗しました',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="border-b border-border bg-gradient-to-br from-primary/10 via-transparent to-transparent p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  Config Studio
                </span>
                {hasPermissionRestrictions ? (
                  <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">
                    権限制限あり
                  </span>
                ) : null}
                {dirty ? (
                  <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">
                    未保存
                  </span>
                ) : null}
                {hasValidationErrors ? (
                  <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-xs text-red-300">
                    エラー {validationErrorCount}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-3 text-xl font-semibold">Plugin設定</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                {hasPermissionRestrictions
                  ? 'Role権限で許可された項目だけ編集できます。閲覧のみの項目は値を確認できますが変更できません。'
                  : '通常はGUIで設定できます。JSONはAdvancedモードからいつでも直接編集できます。'}
              </p>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-4 py-3 sm:min-w-44">
              <div>
                <p className="text-sm font-medium">Plugin</p>
                <p className="text-xs text-muted">{enabled ? '有効' : '無効'}</p>
                {!configAccess.canToggleEnabled ? (
                  <p className="mt-0.5 text-[11px] text-amber-300">操作権限なし</p>
                ) : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={enabled ? 'Pluginを無効化' : 'Pluginを有効化'}
                disabled={!configAccess.canToggleEnabled || saving}
                onClick={() => {
                  setEnabled((current) => !current);
                  setStatus('未保存の変更があります');
                }}
                className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-primary' : 'bg-border'}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="inline-flex w-full rounded-xl border border-border bg-background p-1 sm:w-auto">
              <button
                type="button"
                onClick={() => {
                  if (mode !== 'json') return;
                  if (jsonReadOnly) {
                    setMode('visual');
                    setStatus('');
                    return;
                  }
                  applyJsonToVisual();
                }}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-none ${mode === 'visual' ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'}`}
              >
                かんたん設定
              </button>
              <button
                type="button"
                onClick={enterJsonMode}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-none ${mode === 'json' ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'}`}
              >
                Advanced JSON
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={resetToDefaults}
                disabled={!allConfigFieldsEditable || saving}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                初期値へ戻す
              </button>
              <button
                type="button"
                onClick={undoUnsavedChanges}
                disabled={!dirty}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                変更を元に戻す
              </button>
            </div>
          </div>

          {hasValidationErrors ? (
            <ValidationSummary
              issues={validationIssues}
              jsonError={validationState.jsonError}
              onSelect={jumpToIssue}
            />
          ) : null}

          {mode === 'visual' ? (
            <div className="mt-5 space-y-5">
              <div className="relative">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="設定項目を検索…"
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring"
                  aria-label="設定項目を検索"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-foreground"
                  >
                    クリア
                  </button>
                ) : null}
              </div>

              {rootBranchState ? (
                <SchemaBranchSelector
                  state={rootBranchState}
                  onSelect={selectRootBranch}
                  disabled={!allConfigFieldsEditable}
                />
              ) : null}

              {visibleEntries.length > 0 ? (
                <div className="grid gap-4">
                  {visibleEntries.map(([key, propertySchema]) => {
                    const readOnly = !editableFieldKeySet.has(key);
                    return (
                      <PermissionFieldScope key={key} readOnly={readOnly}>
                        <SchemaField
                          fieldKey={key}
                          schema={
                            findSourcePropertySchema(configSchema, config, key) ?? propertySchema
                          }
                          effectiveSchemaOverride={propertySchema}
                          value={config[key]}
                          path={[key]}
                          required={(effectiveConfigSchema.required ?? []).includes(key)}
                          onChange={update}
                          onRemove={remove}
                          discordOptions={discordOptions}
                          guildId={guildId}
                          issues={validationIssues}
                        />
                      </PermissionFieldScope>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-8 text-center">
                  <p className="font-medium">一致する設定がありません</p>
                  <p className="mt-1 text-sm text-muted">検索条件を変更してください。</p>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-5">
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Advanced JSON</p>
                    <p className="mt-1 text-xs text-muted">
                      {jsonReadOnly
                        ? '閲覧のみの項目が含まれるため、Advanced JSONは閲覧専用です。'
                        : '既存のJSON設定形式と完全互換です。'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={applyJsonToVisual}
                    disabled={jsonReadOnly || Boolean(validationState.jsonError)}
                    className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    JSONをGUIへ反映
                  </button>
                </div>
                <textarea
                  value={jsonText}
                  readOnly={jsonReadOnly}
                  aria-readonly={jsonReadOnly}
                  onChange={(event) => {
                    setJsonText(event.target.value);
                    clearServerIssues();
                    setStatus('未保存の変更があります');
                  }}
                  rows={20}
                  className={`w-full rounded-xl border bg-surface p-4 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring ${hasValidationErrors ? 'border-red-400/60 focus:ring-red-400/20' : 'border-border'}`}
                  aria-label="Plugin設定JSON"
                  aria-invalid={hasValidationErrors}
                  spellCheck={false}
                />
                {validationState.jsonError ? (
                  <p className="mt-2 text-sm text-red-300" role="alert">
                    {validationState.jsonError}
                  </p>
                ) : validationIssues.length > 0 ? (
                  <p className="mt-2 text-xs text-red-300">
                    JSONの形式は正しいですが、Schemaに一致しない設定が{validationIssues.length}
                    件あります。
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="sticky bottom-4 z-20 rounded-2xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className={`text-sm font-medium ${hasValidationErrors ? 'text-red-300' : ''}`}>
              {hasValidationErrors
                ? `入力エラーが${validationErrorCount}件あります`
                : dirty
                  ? '未保存の変更があります'
                  : '設定は保存済みです'}
            </p>
            <p className="mt-1 min-h-5 break-words text-xs text-muted" aria-live="polite">
              {status ||
                (hasPermissionRestrictions
                  ? 'Role権限で許可された操作だけ変更できます。'
                  : 'GUIとJSONは同じ設定データを編集します。')}
            </p>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving || hasValidationErrors || !dirty}
            className="w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {saving
              ? '保存中…'
              : hasValidationErrors
                ? '入力エラーを修正'
                : dirty
                  ? '設定を保存'
                  : '変更なし'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PermissionFieldScope({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      {readOnly ? (
        <div className="mb-2 flex justify-end">
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
            閲覧のみ
          </span>
        </div>
      ) : null}
      <fieldset
        disabled={readOnly}
        className={`m-0 min-w-0 border-0 p-0 ${readOnly ? 'opacity-75' : ''}`}
      >
        {children}
      </fieldset>
    </div>
  );
}

function ValidationSummary({
  issues,
  jsonError,
  onSelect,
}: {
  issues: ConfigValidationIssue[];
  jsonError: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-red-400/30 bg-red-400/5 p-4" role="alert">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-red-200">設定内容を確認してください</p>
          <p className="mt-1 text-xs text-red-200/70">
            エラーが残っている間は保存できません。項目を選ぶと該当箇所へ移動します。
          </p>
        </div>
        <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-xs font-medium text-red-200">
          {issues.length + (jsonError ? 1 : 0)}件
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {jsonError ? (
          <div className="rounded-lg border border-red-400/20 bg-background/60 px-3 py-2 text-sm text-red-200">
            Advanced JSON: {jsonError}
          </div>
        ) : null}
        {issues.map((issue, index) => (
          <button
            key={`${issue.path}-${issue.keyword}-${index}`}
            type="button"
            onClick={() => onSelect(issue.path)}
            disabled={issue.path === '$'}
            className="flex w-full items-start justify-between gap-3 rounded-lg border border-red-400/20 bg-background/60 px-3 py-2 text-left transition hover:border-red-400/40 hover:bg-red-400/5 disabled:cursor-default"
          >
            <span className="min-w-0">
              <span className="block break-all font-mono text-xs text-red-200/70">
                {issue.path}
              </span>
              <span className="mt-0.5 block text-sm text-red-100">{issue.message}</span>
            </span>
            <span className="shrink-0 rounded bg-red-400/10 px-1.5 py-0.5 text-[10px] text-red-200/70">
              {issue.source === 'server' ? 'server' : issue.keyword}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SchemaBranchSelector({
  state,
  onSelect,
  disabled = false,
}: {
  state: SchemaBranchState;
  onSelect: (index: number) => void;
  disabled?: boolean;
}) {
  const activeOption = state.options.find((option) => option.active) ?? state.options[0];
  const selectable = Boolean(getBranchDiscriminatorKey(state));

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{state.label}</p>
          <p className="mt-1 text-xs text-muted">
            {selectable
              ? '選択した設定タイプに必要な項目だけを表示します。既存の値は保持されます。'
              : `${state.mode}の候補は現在の入力値から自動判定されます。`}
          </p>
        </div>
        {selectable ? (
          <select
            value={String(activeOption?.index ?? 0)}
            onChange={(event) => onSelect(Number(event.target.value))}
            disabled={disabled}
            aria-label={state.label}
            className="min-w-48 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.options.map((option) => (
              <option key={option.index} value={option.index}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap gap-2">
            {state.options.map((option) => (
              <span
                key={option.index}
                className={`rounded-full border px-2.5 py-1 text-xs ${option.active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted'}`}
              >
                {option.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SchemaField({
  fieldKey,
  schema,
  effectiveSchemaOverride,
  value,
  path,
  required,
  onChange,
  onRemove,
  discordOptions,
  guildId,
  issues,
}: {
  fieldKey: string;
  schema: JsonSchema;
  effectiveSchemaOverride?: JsonSchema;
  value: unknown;
  path: Path;
  required?: boolean;
  onChange: (path: Path, value: unknown) => void;
  onRemove: (path: Path) => void;
  discordOptions?: GuildConfigurationOptions | null;
  guildId: string;
  issues: ConfigValidationIssue[];
}) {
  const branchState = getSchemaBranchState(schema, value);
  const branchDiscriminatorKey = getBranchDiscriminatorKey(branchState);
  const effectiveSchema = effectiveSchemaOverride ?? resolveSchemaForValue(schema, value);
  const type = schemaPrimaryType(effectiveSchema);
  const nullable = schemaAllowsNull(effectiveSchema);
  const title = effectiveSchema.title ?? schema.title ?? humanizeKey(fieldKey);
  const ui = effectiveSchema['x-herta-ui'];
  const discordMultiple = type === 'array';
  const supportsDiscordPicker =
    type === 'string' ||
    (type === 'array' && schemaPrimaryType(effectiveSchema.items ?? {}) === 'string');
  const messageTargetProperties = effectiveSchema.properties ?? {};
  const supportsDiscordMessageTarget =
    type === 'object' &&
    schemaPrimaryType(messageTargetProperties.channelId ?? {}) === 'string' &&
    schemaPrimaryType(messageTargetProperties.messageId ?? {}) === 'string';

  if (ui?.widget === 'discord-channel' && supportsDiscordPicker) {
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        path={path}
        issues={issues}
      >
        <DiscordChannelPicker
          options={discordOptions?.channels ?? []}
          value={normalizeDiscordEntityValue(value, discordMultiple)}
          multiple={discordMultiple}
          placeholder={ui.placeholder}
          onChange={(next) => onChange(path, next)}
        />
      </FieldShell>
    );
  }

  if (ui?.widget === 'discord-role' && supportsDiscordPicker) {
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        path={path}
        issues={issues}
      >
        <DiscordRolePicker
          options={discordOptions?.roles ?? []}
          value={normalizeDiscordEntityValue(value, discordMultiple)}
          multiple={discordMultiple}
          placeholder={ui.placeholder}
          editableOnly={ui.editableOnly}
          mentionableOnly={ui.mentionableOnly}
          onChange={(next) => onChange(path, next)}
        />
      </FieldShell>
    );
  }

  if (ui?.widget === 'discord-user' && supportsDiscordPicker) {
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        path={path}
        issues={issues}
      >
        <DiscordUserPicker
          guildId={guildId}
          value={normalizeDiscordEntityValue(value, discordMultiple)}
          multiple={discordMultiple}
          placeholder={ui.placeholder}
          onChange={(next) => onChange(path, next)}
        />
      </FieldShell>
    );
  }

  if (ui?.widget === 'discord-emoji' && supportsDiscordPicker) {
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        path={path}
        issues={issues}
      >
        <DiscordEmojiPicker
          options={discordOptions?.emojis ?? []}
          value={normalizeDiscordEntityValue(value, discordMultiple)}
          multiple={discordMultiple}
          placeholder={ui.placeholder}
          onChange={(next) => onChange(path, next)}
        />
      </FieldShell>
    );
  }

  if (ui?.widget === 'discord-message-target' && supportsDiscordMessageTarget) {
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        path={path}
        issues={issues}
      >
        <DiscordMessageTargetPicker
          guildId={guildId}
          channels={discordOptions?.channels ?? []}
          value={value}
          nullable={nullable}
          onChange={(next) => onChange(path, next)}
        />
      </FieldShell>
    );
  }

  if (nullable && value === null) {
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        path={path}
        issues={issues}
      >
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-background/60 p-3">
          <span className="text-sm text-muted">未設定（null）</span>
          <button
            type="button"
            onClick={() =>
              onChange(path, makeDefaultValue({ ...effectiveSchema, nullable: false, type }))
            }
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface"
          >
            値を設定
          </button>
        </div>
      </FieldShell>
    );
  }

  if (type === 'object') {
    const objectValue = isObject(value) ? value : {};
    const childEntries = Object.entries(effectiveSchema.properties ?? {}).filter(
      ([childKey]) => childKey !== branchDiscriminatorKey,
    );
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        emphasized
        path={path}
        issues={issues}
      >
        <div className="grid gap-4">
          {branchState ? (
            <SchemaBranchSelector
              state={branchState}
              onSelect={(index) => onChange(path, selectSchemaBranch(schema, value, index))}
            />
          ) : null}
          {childEntries.map(([childKey, childSchema]) => (
            <SchemaField
              key={childKey}
              fieldKey={childKey}
              schema={findSourcePropertySchema(schema, value, childKey) ?? childSchema}
              effectiveSchemaOverride={childSchema}
              value={objectValue[childKey]}
              path={[...path, childKey]}
              required={(effectiveSchema.required ?? []).includes(childKey)}
              onChange={onChange}
              onRemove={onRemove}
              discordOptions={discordOptions}
              guildId={guildId}
              issues={issues}
            />
          ))}
        </div>
      </FieldShell>
    );
  }

  if (type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemSchema = schema.items ?? effectiveSchema.items ?? {};
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        emphasized
        path={path}
        issues={issues}
      >
        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-background/50 p-5 text-center text-sm text-muted">
              項目はまだありません。
            </div>
          ) : null}
          {items.map((item, index) => (
            <div
              key={index}
              className="rounded-xl border border-border bg-background/60 p-3 sm:p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">項目 {index + 1}</span>
                <div className="flex gap-1">
                  <SmallButton
                    label="上へ"
                    disabled={index === 0}
                    onClick={() => onChange(path, moveArrayItem(items, index, index - 1))}
                  />
                  <SmallButton
                    label="下へ"
                    disabled={index === items.length - 1}
                    onClick={() => onChange(path, moveArrayItem(items, index, index + 1))}
                  />
                  <SmallButton label="削除" danger onClick={() => onRemove([...path, index])} />
                </div>
              </div>
              <SchemaField
                fieldKey={`${fieldKey}-${index}`}
                schema={itemSchema}
                value={item}
                path={[...path, index]}
                onChange={onChange}
                onRemove={onRemove}
                discordOptions={discordOptions}
                guildId={guildId}
                issues={issues}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange(path, [...items, makeDefaultValue(itemSchema)])}
            className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition hover:bg-primary/10"
          >
            ＋ 項目を追加
          </button>
        </div>
      </FieldShell>
    );
  }

  if (effectiveSchema.enum?.length) {
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        path={path}
        issues={issues}
      >
        <select
          value={serializeSelectValue(value)}
          onChange={(event) =>
            onChange(path, deserializeEnumValue(effectiveSchema.enum ?? [], event.target.value))
          }
          className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {effectiveSchema.enum.map((option) => (
            <option key={serializeSelectValue(option)} value={serializeSelectValue(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }

  if (type === 'boolean') {
    const checked = Boolean(value);
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        compact
        path={path}
        issues={issues}
      >
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background/70 px-4 py-3">
          <span className="text-sm text-muted">{checked ? '有効' : '無効'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={`${title}を${checked ? '無効' : '有効'}にする`}
            onClick={() => onChange(path, !checked)}
            className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${checked ? 'bg-primary' : 'bg-border'}`}
          >
            <span
              aria-hidden="true"
              className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
      </FieldShell>
    );
  }

  if (type === 'integer' || type === 'number') {
    return (
      <FieldShell
        title={title}
        schema={effectiveSchema}
        required={required}
        path={path}
        issues={issues}
      >
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={effectiveSchema.minimum}
          max={effectiveSchema.maximum}
          step={type === 'integer' ? 1 : 'any'}
          onChange={(event) => {
            if (event.target.value === '' && nullable) {
              onChange(path, null);
              return;
            }
            const next =
              type === 'integer'
                ? Number.parseInt(event.target.value, 10)
                : Number(event.target.value);
            if (!Number.isNaN(next)) onChange(path, next);
          }}
          className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {effectiveSchema.minimum !== undefined || effectiveSchema.maximum !== undefined ? (
          <p className="mt-2 text-xs text-muted">
            {effectiveSchema.minimum !== undefined ? `最小 ${effectiveSchema.minimum}` : ''}
            {effectiveSchema.minimum !== undefined && effectiveSchema.maximum !== undefined
              ? ' / '
              : ''}
            {effectiveSchema.maximum !== undefined ? `最大 ${effectiveSchema.maximum}` : ''}
          </p>
        ) : null}
      </FieldShell>
    );
  }

  const stringValue = typeof value === 'string' ? value : '';
  const multiline = ui?.widget === 'textarea' || effectiveSchema.format === 'multiline';
  return (
    <FieldShell
      title={title}
      schema={effectiveSchema}
      required={required}
      path={path}
      issues={issues}
    >
      {multiline ? (
        <textarea
          value={stringValue}
          onChange={(event) => onChange(path, event.target.value)}
          rows={4}
          minLength={effectiveSchema.minLength}
          maxLength={effectiveSchema.maxLength}
          placeholder={ui?.placeholder}
          className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <input
          type={
            effectiveSchema.format === 'password'
              ? 'password'
              : effectiveSchema.format === 'url'
                ? 'url'
                : 'text'
          }
          value={stringValue}
          onChange={(event) => onChange(path, event.target.value)}
          minLength={effectiveSchema.minLength}
          maxLength={effectiveSchema.maxLength}
          pattern={effectiveSchema.pattern}
          placeholder={ui?.placeholder}
          className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      )}
      {effectiveSchema.maxLength !== undefined ? (
        <p className="mt-2 text-right text-xs text-muted">
          {stringValue.length} / {effectiveSchema.maxLength}
        </p>
      ) : null}
    </FieldShell>
  );
}

function FieldShell({
  title,
  schema,
  required,
  emphasized,
  compact,
  path,
  issues,
  children,
}: {
  title: string;
  schema: JsonSchema;
  required?: boolean;
  emphasized?: boolean;
  compact?: boolean;
  path: Path;
  issues: ConfigValidationIssue[];
  children: React.ReactNode;
}) {
  const pathText = formatStudioValidationPath(path);
  const directIssues = validationIssuesAtPath(issues, pathText);
  const issueCount = validationIssueCountUnderPath(issues, pathText);
  const invalid = issueCount > 0;

  return (
    <div
      data-config-path={pathText}
      tabIndex={-1}
      className={`min-w-0 rounded-xl border p-4 outline-none transition ${invalid ? 'border-red-400/50 bg-red-400/5 focus:ring-2 focus:ring-red-400/20' : emphasized ? 'border-border bg-surface/70 sm:p-5' : 'border-border/80 bg-background/40'} ${compact ? 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)] sm:items-center sm:gap-5' : ''}`}
    >
      <div className={compact ? '' : 'mb-3'}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="break-words text-sm font-semibold">{title}</label>
          {required ? (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              required
            </span>
          ) : null}
          {schema['x-herta-ui']?.section ? (
            <span className="rounded bg-border/50 px-1.5 py-0.5 text-[10px] text-muted">
              {schema['x-herta-ui']?.section}
            </span>
          ) : null}
          {invalid ? (
            <span className="rounded bg-red-400/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
              エラー {issueCount}
            </span>
          ) : null}
        </div>
        {schema.description ? (
          <p className="mt-1 text-xs leading-5 text-muted">{schema.description}</p>
        ) : null}
        {schema['x-herta-ui']?.help ? (
          <p className="mt-1 text-xs leading-5 text-muted">{schema['x-herta-ui']?.help}</p>
        ) : null}
        {schema['x-herta-ui']?.destructive ? (
          <p className="mt-2 text-xs font-medium text-red-300">
            この設定はユーザーやデータへ影響する可能性があります。
          </p>
        ) : null}
      </div>
      <div>
        {children}
        {directIssues.length > 0 ? (
          <div className="mt-2 space-y-1" role="alert">
            {directIssues.map((issue, index) => (
              <p key={`${issue.keyword}-${index}`} className="text-xs font-medium text-red-300">
                {issue.message}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SmallButton({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-30 ${danger ? 'border-red-400/20 text-red-300 hover:bg-red-400/10' : 'border-border text-muted hover:bg-surface hover:text-foreground'}`}
    >
      {label}
    </button>
  );
}

function findSourcePropertySchema(
  schema: JsonSchema,
  value: unknown,
  key: string,
): JsonSchema | null {
  const composed = schema as ComposedJsonSchema;
  const branchState = getSchemaBranchState(schema, value);
  if (branchState) {
    const branches = composed[branchState.mode] ?? [];
    for (const option of branchState.options) {
      if (!option.active) continue;
      const branch = branches[option.index];
      if (!branch) continue;
      const found = findSourcePropertySchema(branch, value, key);
      if (found) return found;
    }
  }

  if (composed.if) {
    const conditional = schemaMatchesValue(composed.if, value) ? composed.then : composed.else;
    if (conditional) {
      const found = findSourcePropertySchema(conditional, value, key);
      if (found) return found;
    }
  }

  return schema.properties?.[key] ?? null;
}

function getBranchDiscriminatorKey(state: SchemaBranchState | null): string | null {
  if (!state || state.options.length === 0) return null;
  const keys = state.options.map((option) => option.discriminatorKey);
  const first = keys[0];
  if (!first || keys.some((key) => key !== first)) return null;
  return first;
}

function normalizeDiscordEntityValue(value: unknown, multiple: boolean): string | string[] | null {
  if (multiple) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
  return typeof value === 'string' && value ? value : null;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeSelectValue(value: unknown): string {
  return JSON.stringify(value);
}

function deserializeEnumValue(options: unknown[], serialized: string): unknown {
  return options.find((option) => serializeSelectValue(option) === serialized);
}

async function readResponse(response: Response): Promise<PluginUpdateResponse | null> {
  try {
    return (await response.json()) as PluginUpdateResponse;
  } catch {
    return null;
  }
}

function formatApiError(result: PluginUpdateResponse | null, fallback: string): string {
  const message = typeof result?.error === 'string' ? result.error : fallback;
  if (!Array.isArray(result?.details)) return message;

  const details = result.details
    .map((detail) => {
      if (!isObject(detail)) return null;
      const path = typeof detail.instancePath === 'string' ? detail.instancePath : '';
      const description = typeof detail.message === 'string' ? detail.message : '';
      if (!path && !description) return null;
      return `${path || '設定'} ${description}`.trim();
    })
    .filter((detail): detail is string => Boolean(detail));

  return details.length > 0 ? `${message}: ${details.join('、')}` : message;
}
