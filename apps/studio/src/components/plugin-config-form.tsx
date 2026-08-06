'use client';

import { useState } from 'react';

type Schema = {
  properties?: Record<
    string,
    { title?: string; description?: string; type?: string; default?: unknown }
  >;
};

type PluginUpdateResponse = {
  error?: unknown;
  details?: unknown;
  config?: Record<string, unknown>;
};

export function PluginConfigForm({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  schema,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  schema: Record<string, unknown>;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [config, setConfig] = useState(JSON.stringify(initialConfig, null, 2));
  const [status, setStatus] = useState('');
  const properties = (schema as Schema).properties ?? {};

  async function save() {
    setStatus('保存中…');
    try {
      const parsed = JSON.parse(config) as unknown;
      if (!isObject(parsed)) {
        setStatus('設定JSONはオブジェクト形式で入力してください');
        return;
      }

      const response = await fetch(`/api/guilds/${guildId}/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, config: parsed }),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        throw new Error(formatApiError(result, '保存に失敗しました'));
      }

      setConfig(JSON.stringify(result?.config ?? parsed, null, 2));
      setStatus('保存しました');
    } catch (error) {
      setStatus(
        error instanceof SyntaxError
          ? 'JSON の形式が不正です'
          : error instanceof Error
            ? error.message
            : '保存に失敗しました',
      );
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-medium">Plugin 設定</h2>
          <p className="mt-1 text-sm text-muted">JSON Schema に基づく設定です。</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? 'Pluginを無効化' : 'Pluginを有効化'}
          onClick={() => setEnabled(!enabled)}
          className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${enabled ? 'bg-primary' : 'bg-border'}`}
        >
          <span
            aria-hidden="true"
            className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
      </div>
      {Object.keys(properties).length > 0 ? (
        <ul className="mt-5 space-y-2 text-sm">
          {Object.entries(properties).map(([key, property]) => (
            <li key={key} className="min-w-0 rounded-lg bg-background p-3">
              <span className="break-words font-medium">{property.title ?? key}</span>
              {property.description ? (
                <span className="ml-2 break-words text-muted">{property.description}</span>
              ) : null}
              <span className="ml-2 text-xs text-muted">({property.type ?? 'unknown'})</span>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        value={config}
        onChange={(event) => setConfig(event.target.value)}
        rows={10}
        className="mt-5 w-full rounded-xl border border-border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
        aria-label="Plugin 設定 JSON"
        spellCheck={false}
      />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-h-5 break-words text-sm text-muted" aria-live="polite">
          {status}
        </span>
        <button
          type="button"
          onClick={save}
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 sm:w-auto"
        >
          保存
        </button>
      </div>
    </div>
  );
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
