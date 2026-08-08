'use client';

import { useState } from 'react';

export function PluginToggle({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  ariaLabel = 'Pluginの有効状態を切り替え',
  onEnabledChange,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  ariaLabel?: string;
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setStatus('saving');
    try {
      const response = await fetch(`/api/guilds/${guildId}/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next, config: initialConfig }),
      });
      if (!response.ok) throw new Error('update failed');
      setStatus('success');
      onEnabledChange?.(next);
    } catch {
      setEnabled(!next);
      setStatus('error');
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={enabled}
        disabled={status === 'saving'}
        onClick={toggle}
        className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-border'} disabled:opacity-60`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
      <span className={`text-[11px] ${status === 'error' ? 'text-red-500' : 'text-muted'}`}>
        {status === 'saving'
          ? '保存中…'
          : status === 'success'
            ? '保存しました'
            : status === 'error'
              ? '失敗しました'
              : enabled
                ? '有効'
                : '無効'}
      </span>
    </div>
  );
}
