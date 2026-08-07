'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
  automaticCase?: { caseNumber?: number; created?: boolean } | null;
};

type CaseResponse = {
  error?: string;
  case?: { caseNumber?: number } | null;
  caseNumber?: number;
  created?: boolean;
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
  const [caseNumber, setCaseNumber] = useState<number | null>(null);
  const [caseLoading, setCaseLoading] = useState(initialStatus === 'confirmed');
  const [caseCreating, setCaseCreating] = useState(false);
  const [caseMessage, setCaseMessage] = useState<string | null>(null);

  const normalizedNote = normalizeNote(reviewNote);
  const isDirty = reviewStatus !== savedStatus || normalizedNote !== savedNote;
  const caseEndpoint = `/api/guilds/${guildId}/moderation/detections/${detectionId}/case`;

  useEffect(() => {
    if (savedStatus !== 'confirmed' || caseNumber !== null) {
      setCaseLoading(false);
      return;
    }

    const controller = new AbortController();
    setCaseLoading(true);
    setCaseMessage(null);
    void fetch(caseEndpoint, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as CaseResponse;
        if (!response.ok) throw new Error(body.error ?? 'ケース情報を取得できませんでした');
        setCaseNumber(readCaseNumber(body));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setCaseMessage(error instanceof Error ? error.message : 'ケース情報を取得できませんでした');
      })
      .finally(() => setCaseLoading(false));

    return () => controller.abort();
  }, [caseEndpoint, caseNumber, savedStatus]);

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

      const automaticCaseNumber = readCaseNumber(body.automaticCase ?? {});
      if (automaticCaseNumber !== null) {
        setCaseNumber(automaticCaseNumber);
        setCaseMessage(
          body.automaticCase?.created === false
            ? `対象ルールのCase #${automaticCaseNumber}を表示します`
            : `対象ルールのためCase #${automaticCaseNumber}を自動作成しました`,
        );
      } else if (resolvedStatus !== 'confirmed') {
        setCaseNumber(null);
        setCaseMessage(null);
      }

      setMessage('保存しました');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'レビューを保存できませんでした');
    } finally {
      setSaving(false);
    }
  }

  async function createCase() {
    if (caseCreating || savedStatus !== 'confirmed') return;
    setCaseCreating(true);
    setCaseMessage(null);
    try {
      const response = await fetch(caseEndpoint, { method: 'POST' });
      const body = (await response.json()) as CaseResponse;
      if (!response.ok) throw new Error(body.error ?? 'ケースを作成できませんでした');
      const resolvedCaseNumber = readCaseNumber(body);
      if (resolvedCaseNumber === null) throw new Error('作成したケース番号を取得できませんでした');
      setCaseNumber(resolvedCaseNumber);
      setCaseMessage(
        body.created === false ? '作成済みのケースを表示します' : 'ケースを作成しました',
      );
      router.refresh();
    } catch (error) {
      setCaseMessage(error instanceof Error ? error.message : 'ケースを作成できませんでした');
    } finally {
      setCaseCreating(false);
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

      {savedStatus === 'confirmed' || caseNumber !== null ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-muted">
            Discord上の削除・警告・Timeoutは行わず、追跡用ケースだけを作成します。
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-h-4 break-words text-xs text-muted" aria-live="polite">
              {caseMessage}
            </span>
            {caseNumber !== null ? (
              <Link
                href={`/dashboard/guilds/${guildId}/moderation/${caseNumber}`}
                className="w-full rounded-lg border border-primary px-3 py-2 text-center text-xs font-semibold text-primary hover:bg-primary/10 sm:w-auto sm:py-1.5"
              >
                Case #{caseNumber}を開く
              </Link>
            ) : (
              <button
                type="button"
                onClick={createCase}
                disabled={caseLoading || caseCreating || savedStatus !== 'confirmed'}
                className="w-full rounded-lg border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:py-1.5"
              >
                {caseLoading ? '確認中…' : caseCreating ? '作成中…' : 'ケースを作成'}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </details>
  );
}

function normalizeNote(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function readCaseNumber(body: CaseResponse): number | null {
  const value = body.caseNumber ?? body.case?.caseNumber;
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : null;
}
