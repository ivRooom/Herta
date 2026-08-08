'use client';

import { useMemo, useState } from 'react';

import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import {
  DiscordChannelPicker,
  DiscordEmojiPicker,
  DiscordRolePicker,
} from './discord-entity-picker';
import { DiscordMessageTargetPicker } from './discord-message-target-picker';
import { DiscordUserPicker } from './discord-user-picker';

import {
  fieldMatchesSearch,
  makeDefaultValue,
  moveArrayItem,
  normalizeConfigForStudio,
  parseConfigJson,
  removeConfigValue,
  resolveArrayItemBounds,
  schemaAllowsNull,
  schemaPrimaryType,
  stringifyConfig,
  updateConfigValue,
  type ConfigObject,
  type JsonSchema,
} from '../lib/plugin-config-studio';

type PluginUpdateResponse = {
  error?: unknown;
  details?: unknown;
  config?: Record<string, unknown>;
};

type Path = Array<string | number>;

export function PluginConfigStudioForm({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  schema,
  discordOptions,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  schema: Record<string, unknown>;
  discordOptions?: GuildConfigurationOptions | null;
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

  const savedConfigText = stringifyConfig(savedConfig);
  const dirty =
    enabled !== savedEnabled ||
    (mode === 'json' ? jsonText !== savedConfigText : stringifyConfig(config) !== savedConfigText);
  const properties = configSchema.properties ?? {};
  const visibleEntries = Object.entries(properties).filter(([key, propertySchema]) =>
    fieldMatchesSearch(key, propertySchema, query),
  );

  function update(path: Path, nextValue: unknown) {
    setConfig((current) => updateConfigValue(current, path, nextValue) as ConfigObject);
    setStatus('未保存の変更があります');
  }

  function remove(path: Path) {
    setConfig((current) => removeConfigValue(current, path) as ConfigObject);
    setStatus('未保存の変更があります');
  }

  function enterJsonMode() {
    setJsonText(stringifyConfig(config));
    setStatus('');
    setMode('json');
  }

  function applyJsonToVisual() {
    try {
      const parsed = parseConfigJson(jsonText);
      const normalized = normalizeConfigForStudio(configSchema, parsed);
      setConfig(normalized);
      setJsonText(stringifyConfig(normalized));
      setStatus('JSONをGUIへ反映しました');
      setMode('visual');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'JSONの形式が不正です');
    }
  }

  function resetToDefaults() {
    const next = normalizeConfigForStudio(configSchema, {});
    setConfig(next);
    setJsonText(stringifyConfig(next));
    setStatus('Schemaの初期値へ戻しました。保存するまで反映されません');
  }

  function undoUnsavedChanges() {
    setConfig(savedConfig);
    setEnabled(savedEnabled);
    setJsonText(stringifyConfig(savedConfig));
    setStatus('未保存の変更を破棄しました');
  }

  async function save() {
    setSaving(true);
    setStatus('保存中…');
    try {
      const payloadConfig = mode === 'json' ? parseConfigJson(jsonText) : config;
      const response = await fetch(`/api/guilds/${guildId}/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, config: payloadConfig }),
      });
      const result = await readResponse(response);
      if (!response.ok) throw new Error(formatApiError(result, '保存に失敗しました'));

      const normalized = normalizeConfigForStudio(configSchema, result?.config ?? payloadConfig);
      setConfig(normalized);
      setSavedConfig(normalized);
      setSavedEnabled(enabled);
      setJsonText(stringifyConfig(normalized));
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
                {dirty ? (
                  <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">
                    未保存
                  </span>
                ) : null}
              </div>
              <h2 className="mt-3 text-xl font-semibold">Plugin設定</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                通常はGUIで設定できます。JSONはAdvancedモードからいつでも直接編集できます。
              </p>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-4 py-3 sm:min-w-44">
              <div>
                <p className="text-sm font-medium">Plugin</p>
                <p className="text-xs text-muted">{enabled ? '有効' : '無効'}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={enabled ? 'Pluginを無効化' : 'Pluginを有効化'}
                onClick={() => {
                  setEnabled((current) => !current);
                  setStatus('未保存の変更があります');
                }}
                className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${enabled ? 'bg-primary' : 'bg-border'}`}
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
                  if (mode === 'json') applyJsonToVisual();
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
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:bg-background hover:text-foreground"
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

              {visibleEntries.length > 0 ? (
                <div className="grid gap-4">
                  {visibleEntries.map(([key, propertySchema]) => (
                    <SchemaField
                      key={key}
                      fieldKey={key}
                      schema={propertySchema}
                      value={config[key]}
                      path={[key]}
                      required={(configSchema.required ?? []).includes(key)}
                      onChange={update}
                      onRemove={remove}
                      discordOptions={discordOptions}
                      guildId={guildId}
                    />
                  ))}
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
                    <p className="mt-1 text-xs text-muted">既存のJSON設定形式と完全互換です。</p>
                  </div>
                  <button
                    type="button"
                    onClick={applyJsonToVisual}
                    className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15"
                  >
                    JSONをGUIへ反映
                  </button>
                </div>
                <textarea
                  value={jsonText}
                  onChange={(event) => {
                    setJsonText(event.target.value);
                    setStatus('未保存の変更があります');
                  }}
                  rows={20}
                  className="w-full rounded-xl border border-border bg-surface p-4 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Plugin設定JSON"
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="sticky bottom-4 z-20 rounded-2xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {dirty ? '未保存の変更があります' : '設定は保存済みです'}
            </p>
            <p className="mt-1 min-h-5 break-words text-xs text-muted" aria-live="polite">
              {status || 'GUIとJSONは同じ設定データを編集します。'}
            </p>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
          >
            {saving ? '保存中…' : '設定を保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SchemaField({
  fieldKey,
  schema,
  value,
  path,
  required,
  onChange,
  onRemove,
  discordOptions,
  guildId,
}: {
  fieldKey: string;
  schema: JsonSchema;
  value: unknown;
  path: Path;
  required?: boolean;
  onChange: (path: Path, value: unknown) => void;
  onRemove: (path: Path) => void;
  discordOptions?: GuildConfigurationOptions | null;
  guildId: string;
}) {
  const type = schemaPrimaryType(schema);
  const nullable = schemaAllowsNull(schema);
  const title = schema.title ?? humanizeKey(fieldKey);
  const ui = schema['x-herta-ui'];
  const discordMultiple = type === 'array';
  const supportsDiscordPicker =
    type === 'string' || (type === 'array' && schemaPrimaryType(schema.items ?? {}) === 'string');
  const messageTargetProperties = schema.properties ?? {};
  const supportsDiscordMessageTarget =
    type === 'object' &&
    schemaPrimaryType(messageTargetProperties.channelId ?? {}) === 'string' &&
    schemaPrimaryType(messageTargetProperties.messageId ?? {}) === 'string';

  if (ui?.widget === 'discord-channel' && supportsDiscordPicker) {
    return (
      <FieldShell title={title} schema={schema} required={required}>
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
      <FieldShell title={title} schema={schema} required={required}>
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
      <FieldShell title={title} schema={schema} required={required}>
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
      <FieldShell title={title} schema={schema} required={required}>
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
      <FieldShell title={title} schema={schema} required={required}>
        <DiscordMessageTargetPicker
          guildId={guildId}
          channels={discordOptions?.channels ?? []}
          value={value}
          onChange={(next) => onChange(path, next)}
        />
      </FieldShell>
    );
  }

  if (nullable && value === null) {
    return (
      <FieldShell title={title} schema={schema} required={required}>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-background/60 p-3">
          <span className="text-sm text-muted">未設定（null）</span>
          <button
            type="button"
            onClick={() => onChange(path, makeDefaultValue({ ...schema, nullable: false, type }))}
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
    return (
      <FieldShell title={title} schema={schema} required={required} emphasized>
        <div className="grid gap-4">
          {Object.entries(schema.properties ?? {}).map(([childKey, childSchema]) => (
            <SchemaField
              key={childKey}
              fieldKey={childKey}
              schema={childSchema}
              value={objectValue[childKey]}
              path={[...path, childKey]}
              required={(schema.required ?? []).includes(childKey)}
              onChange={onChange}
              onRemove={onRemove}
              discordOptions={discordOptions}
              guildId={guildId}
            />
          ))}
        </div>
      </FieldShell>
    );
  }

  if (type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemSchema = schema.items ?? {};
    const { minItems, maxItems } = resolveArrayItemBounds(schema);
    const atMinimum = items.length <= minItems;
    const atMaximum = maxItems !== undefined && items.length >= maxItems;
    return (
      <FieldShell title={title} schema={schema} required={required} emphasized>
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
                  <SmallButton
                    label="削除"
                    danger
                    disabled={atMinimum}
                    onClick={() => onRemove([...path, index])}
                  />
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
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>現在 {items.length}件</span>
            <span>
              {minItems > 0 ? `最小 ${minItems}件` : '最小制限なし'}
              {' / '}
              {maxItems !== undefined ? `最大 ${maxItems}件` : '最大制限なし'}
            </span>
          </div>
          <button
            type="button"
            disabled={atMaximum}
            onClick={() => onChange(path, [...items, makeDefaultValue(itemSchema)])}
            className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary/5"
          >
            {atMaximum ? `最大 ${maxItems}件までです` : '＋ 項目を追加'}
          </button>
        </div>
      </FieldShell>
    );
  }

  if (schema.enum?.length) {
    return (
      <FieldShell title={title} schema={schema} required={required}>
        <select
          value={serializeSelectValue(value)}
          onChange={(event) =>
            onChange(path, deserializeEnumValue(schema.enum ?? [], event.target.value))
          }
          className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {schema.enum.map((option) => (
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
      <FieldShell title={title} schema={schema} required={required} compact>
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
      <FieldShell title={title} schema={schema} required={required}>
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={schema.minimum}
          max={schema.maximum}
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
        {schema.minimum !== undefined || schema.maximum !== undefined ? (
          <p className="mt-2 text-xs text-muted">
            {schema.minimum !== undefined ? `最小 ${schema.minimum}` : ''}
            {schema.minimum !== undefined && schema.maximum !== undefined ? ' / ' : ''}
            {schema.maximum !== undefined ? `最大 ${schema.maximum}` : ''}
          </p>
        ) : null}
      </FieldShell>
    );
  }

  const stringValue = typeof value === 'string' ? value : '';
  const multiline = ui?.widget === 'textarea' || schema.format === 'multiline';
  return (
    <FieldShell title={title} schema={schema} required={required}>
      {multiline ? (
        <textarea
          value={stringValue}
          onChange={(event) => onChange(path, event.target.value)}
          rows={4}
          minLength={schema.minLength}
          maxLength={schema.maxLength}
          placeholder={ui?.placeholder}
          className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <input
          type={
            schema.format === 'password' ? 'password' : schema.format === 'url' ? 'url' : 'text'
          }
          value={stringValue}
          onChange={(event) => onChange(path, event.target.value)}
          minLength={schema.minLength}
          maxLength={schema.maxLength}
          pattern={schema.pattern}
          placeholder={ui?.placeholder}
          className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      )}
      {schema.maxLength !== undefined ? (
        <p className="mt-2 text-right text-xs text-muted">
          {stringValue.length} / {schema.maxLength}
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
  children,
}: {
  title: string;
  schema: JsonSchema;
  required?: boolean;
  emphasized?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border p-4 ${emphasized ? 'border-border bg-surface/70 sm:p-5' : 'border-border/80 bg-background/40'} ${compact ? 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)] sm:items-center sm:gap-5' : ''}`}
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
      <div>{children}</div>
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
