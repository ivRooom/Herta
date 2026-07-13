'use client';

import { useState } from 'react';

type Schema = {
  properties?: Record<
    string,
    { title?: string; description?: string; type?: string; default?: unknown }
  >;
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
      const parsed = JSON.parse(config);
      const response = await fetch(`/api/guilds/${guildId}/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, config: parsed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '保存に失敗しました');
      setConfig(JSON.stringify(result.config, null, 2));
      setStatus('保存しました');
    } catch (error) {
      setStatus(error instanceof SyntaxError ? 'JSON の形式が不正です' : '保存に失敗しました');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Plugin 設定</h2>
          <p className="mt-1 text-sm text-muted">JSON Schema に基づく設定です。</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`relative h-6 w-11 rounded-full ${enabled ? 'bg-primary' : 'bg-border'}`}
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full bg-white ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>
      {Object.keys(properties).length > 0 ? (
        <ul className="mt-5 space-y-2 text-sm">
          {Object.entries(properties).map(([key, property]) => (
            <li key={key} className="rounded-lg bg-background p-3">
              <span className="font-medium">{property.title ?? key}</span>
              {property.description ? (
                <span className="ml-2 text-muted">{property.description}</span>
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
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-muted">{status}</span>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          保存
        </button>
      </div>
    </div>
  );
}
