'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ModerationCaseStatus } from '@herta/plugin-catalog/moderation-service';

export interface ModerationCaseEditorProps {
  guildId: string;
  caseNumber: number;
  initialReason: string | null;
  initialStatus: ModerationCaseStatus;
  maxReasonLength: number;
}

export function ModerationCaseEditor({
  guildId,
  caseNumber,
  initialReason,
  initialStatus,
  maxReasonLength,
}: ModerationCaseEditorProps) {
  const router = useRouter();
  const [reason, setReason] = useState(initialReason ?? '');
  const [status, setStatus] = useState<ModerationCaseStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/moderation/cases/${caseNumber}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason, status }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'ケースを更新できませんでした');
      setMessage('ケースを更新しました');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ケースを更新できませんでした');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
      <h2 className="font-medium">ケースを更新</h2>
      <p className="mt-1 text-sm text-muted">
        理由の修正とケース状態の変更はAudit Logへ記録されます。
      </p>

      <label className="mt-5 block">
        <span className="text-sm font-medium">理由</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={maxReasonLength}
          rows={5}
          className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="mt-1 block text-right text-xs text-muted">
          {reason.length} / {maxReasonLength}
        </span>
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-medium">状態</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as ModerationCaseStatus)}
          className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="active">有効</option>
          <option value="completed">完了</option>
          <option value="revoked">解除済み</option>
          <option value="failed">失敗</option>
        </select>
      </label>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {message}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? '保存中…' : '変更を保存'}
        </button>
      </div>
    </div>
  );
}
