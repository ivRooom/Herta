'use client';

import { useState } from 'react';

export function ModerationBlacklistToggle({
  guildId,
  userId,
  initialActive,
}: {
  guildId: string;
  userId: string;
  initialActive: boolean;
}) {
  const [active, setActive] = useState(initialActive);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  async function toggle() {
    const next = !active;
    if (
      next &&
      !window.confirm('このユーザーをブラックリストへ再登録しますか？再参加時に自動BANされます。')
    ) {
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/moderation/blacklist/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: next }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { error?: unknown; entry?: { active?: boolean } }
        | null;
      if (!response.ok) {
        throw new Error(typeof result?.error === 'string' ? result.error : '更新に失敗しました');
      }
      setActive(result?.entry?.active ?? next);
      setStatus(next ? '再有効化しました' : '解除しました');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-1 sm:items-end">
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60 ${
          active
            ? 'border-destructive/40 text-destructive hover:bg-destructive/5'
            : 'border-border hover:bg-background'
        }`}
      >
        {saving ? '更新中…' : active ? 'ブラックリスト解除' : '再有効化'}
      </button>
      <span className="min-h-4 text-xs text-muted" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
