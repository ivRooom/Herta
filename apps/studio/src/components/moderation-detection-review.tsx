'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ModerationDetectionReviewStatus } from '@herta/plugin-catalog/moderation-service';

export interface ModerationDetectionReviewProps {
  guildId: string;
  detectionId: string;
  initialStatus: ModerationDetectionReviewStatus;
  initialNote: string | null;
  showQuickActions?: boolean;
}

type ReviewResponse = {
  error?: string;
  reviewStatus?: ModerationDetectionReviewStatus;
  reviewNote?: string | null;
};

const QUICK_STATUSES: Array<{
  value: Exclude<ModerationDetectionReviewStatus, 'unreviewed'>;
  label: string;
}> = [
  { value: 'confirmed', label: '正検知' },
  { value: 'false_positive', label: '誤検知' },
  { value: 'ignored', label: '無視' },
];

export function ModerationDetectionReview({
  guildId,
  detectionId,
  initialStatus,
  initialNote,
  showQuickActions = false,
}: ModerationDetectionReviewProps) {
  const router = useRouter();
  const initialNormalizedNote = normalizeNote(initialNote);
  const [reviewStatus, setReviewStatus] = useState<ModerationDetectionReviewStatus>(initialStatus);
  const [reviewNote, setReviewNote] = useState(initialNormalizedNote);
  const [savedStatus, setSavedStatus] = useState<ModerationDetectionReviewStatus>(initialStatus);
  const [savedNote, setSavedNote] = useState(initialNormalizedNote);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedNote = normalizeNote(reviewNote);
  const isDirty = reviewStatus !== savedStatus || normalizedNote !== savedNote;

  async function save(nextStatus: ModerationDetectionReviewStatus = reviewStatus) {
    const nextNote = normalizeNote(reviewNote);
    if (saving) return;
    if (nextStatus === savedStatus && nextNote === savedNote) {
      setMessage('変更はありません');
      return;
    }

    setSaving(true);
    setMessage(null);
    setReviewStatus(nextStatus);
    try {
      const response = await fetch(`/api/guilds/${guildId}/moderation/detections/${detectionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviewStatus: nextStatus, reviewNote: nextNote }),
      });
      const body = (await response.json()) as ReviewResponse;
      if (!response.ok) {
        throw new Error(body.error ?? 'レビューを保存できませんでした');
      }

      const resolvedStatus = body.reviewStatus ?? nextStatus;
      const resolvedNote = normalizeNote(body.reviewNote ?? nextNote);
      setReviewStatus(resolvedStatus);
      setReviewNote(resolvedNote);
      setSavedStatus(resolvedStatus);
      setSavedNote(resolvedNote);
      setMessage('保存しました');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'レビューを保存できませんでした');
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="w-full min-w-0 rounded-xl border border-border bg-background p-3">
      <summary className="cursor-pointer text-sm font-medium">レビュー</summary>

      {showQuickActions ? (
        <div className="mt-3">
          <span className="text-xs text-muted">クイック判定</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {QUICK_STATUSES.map((status) => (
              <button
                key={status.value}
                type="button"
                onClick={() => save(status.value)}
                disabled={saving}
                aria-pressed={reviewStatus === status.value}
                className={`min-w-0 rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  reviewStatus === status.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-surface text-muted hover:text-foreground'
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <label className="mt-3 block">
        <span className="text-xs text-muted">判定</span>
        <select
          value={reviewStatus}
          onChange={(event) => {
            setReviewStatus(event.target.value as ModerationDetectionReviewStatus);
            setMessage(null);
          }}
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
          onChange={(event) => {
            setReviewNote(event.target.value);
            setMessage(null);
          }}
          maxLength={500}
          rows={3}
          className="mt-1 w-full resize-y rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="判定理由や改善メモ"
        />
      </label>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-h-4 break-words text-xs text-muted" aria-live="polite">
          {message}
        </span>
        <button
          type="button"
          onClick={() => save()}
          disabled={saving || !isDirty}
          className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:py-1.5"
        >
          {saving ? '保存中…' : isDirty ? '保存' : '保存済み'}
        </button>
      </div>
    </details>
  );
}

function normalizeNote(value: string | null | undefined): string {
  return value?.trim() ?? '';
}
