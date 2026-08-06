'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ModerationDetectionReviewStatus } from '@herta/plugin-catalog/moderation-service';

export interface ModerationDetectionReviewProps {
  guildId: string;
  detectionId: string;
  initialStatus: ModerationDetectionReviewStatus;
  initialNote: string | null;
}

export function ModerationDetectionReview({
  guildId,
  detectionId,
  initialStatus,
  initialNote,
}: ModerationDetectionReviewProps) {
  const router = useRouter();
  const [reviewStatus, setReviewStatus] = useState<ModerationDetectionReviewStatus>(initialStatus);
  const [reviewNote, setReviewNote] = useState(initialNote ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/moderation/detections/${detectionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviewStatus, reviewNote }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? 'レビューを保存できませんでした');
      }
      setMessage('保存しました');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'レビューを保存できませんでした');
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="min-w-52 rounded-xl border border-border bg-background p-3">
      <summary className="cursor-pointer text-sm font-medium">レビュー</summary>
      <label className="mt-3 block">
        <span className="text-xs text-muted">判定</span>
        <select
          value={reviewStatus}
          onChange={(event) =>
            setReviewStatus(event.target.value as ModerationDetectionReviewStatus)
          }
          className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="unreviewed">未確認</option>
          <option value="confirmed">正検知</option>
          <option value="false_positive">誤検知</option>
          <option value="ignored">無視</option>
        </select>
      </label>
      <label className="mt-2 block">
        <span className="text-xs text-muted">備考</span>
        <textarea
          value={reviewNote}
          onChange={(event) => setReviewNote(event.target.value)}
          maxLength={500}
          rows={3}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="判定理由や改善メモ"
        />
      </label>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted" aria-live="polite">
          {message}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </details>
  );
}
