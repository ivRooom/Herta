'use client';

import { useEffect, useState } from 'react';

export function PluginToggle({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  ariaLabel = 'Pluginの有効状態を切り替え',
  disabled = false,
  onEnabledChange,
  onSavingChange,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  ariaLabel?: string;
  disabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  useEffect(() => {
    setEnabled(initialEnabled);
    setStatus('idle');
  }, [initialEnabled]);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setStatus('saving');
    onSavingChange?.(true);
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
    } finally {
      onSavingChange?.(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={enabled}
        aria-busy={status === 'saving'}
        disabled={disabled || status === 'saving'}
        onClick={toggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${enabled ? 'bg-primary' : 'bg-border'} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span
          aria-hidden="true"
          className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
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
