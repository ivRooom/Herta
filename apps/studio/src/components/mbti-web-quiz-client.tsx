'use client';

import { useEffect, useState } from 'react';
import {
  computeMbtiAxisPercent,
  MBTI_AXES,
  MBTI_IDENTITY_INFO,
  MBTI_LIKERT_ANSWERS,
  MBTI_TYPES,
  mbtiLikertLabel,
  type MbtiLikertAnswer,
  type MbtiScores,
} from '@herta/shared/mbti-core';

const REQUEST_TIMEOUT_MS = 15_000;

interface QuizQuestion {
  id: number;
  axis: string;
  prompt: string;
}

interface CompleteResult {
  resultType: string;
  resultIdentity: 'A' | 'T';
  scores: MbtiScores;
  roleNote: string | null;
}

export function MbtiWebQuizClient({
  sessionId,
  questions,
  initialAnsweredCount,
}: {
  sessionId: string;
  questions: QuizQuestion[];
  initialAnsweredCount: number;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialAnsweredCount);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompleteResult | null>(null);

  const question = questions[currentIndex];
  // 最後の回答(/answer)は成功したがブラウザが閉じるなどで/completeが未送信のまま
  // 再度リンクを開いたケース。pendingのまま全問回答済みになっているため、エラーに
  // せず自動的に完了処理を呼ぶ(ユーザーは結果を見れずに有効期限切れになってしまう)。
  useEffect(() => {
    if (!question && !result && !error) {
      void complete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, result, error]);

  if (result) return <ResultScreen result={result} />;

  if (!question) {
    return error ? (
      <StatusCard title="診断結果を計算できませんでした" detail={error} />
    ) : (
      <StatusCard title="結果を計算しています…" detail="少々お待ちください。" />
    );
  }

  async function answer(value: MbtiLikertAnswer) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/mbti/${sessionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIndex: currentIndex, answer: value }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        isLastQuestion?: boolean;
        nextQuestionIndex?: number;
      } | null;
      if (!response.ok || !payload) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : '回答を送信できませんでした',
        );
      }

      if (payload.isLastQuestion) {
        await complete();
        return;
      }
      setCurrentIndex(payload.nextQuestionIndex ?? currentIndex + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '回答を送信できませんでした');
    } finally {
      setSubmitting(false);
    }
  }

  async function complete() {
    try {
      const response = await fetch(`/api/mbti/${sessionId}/complete`, {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as
        (CompleteResult & { error?: undefined }) | { error: string } | null;
      if (!response.ok || !payload || 'error' in payload) {
        throw new Error(
          payload && 'error' in payload ? payload.error : '診断結果を計算できませんでした',
        );
      }
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '診断結果を計算できませんでした');
    }
  }

  const progress = Math.round((currentIndex / questions.length) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {currentIndex + 1} / {questions.length}
        </span>
        <span>{progress}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="py-6 text-center text-lg font-semibold leading-8">{question.prompt}</p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {MBTI_LIKERT_ANSWERS.map((value) => (
          <button
            key={value}
            type="button"
            disabled={submitting}
            onClick={() => void answer(value)}
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:bg-primary/10 disabled:opacity-50"
          >
            {mbtiLikertLabel(value)}
          </button>
        ))}
      </div>

      {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}
    </div>
  );
}

function ResultScreen({ result }: { result: CompleteResult }) {
  const info = MBTI_TYPES[result.resultType];
  const identityInfo = MBTI_IDENTITY_INFO[result.resultIdentity];

  return (
    <div className="space-y-5 text-center">
      <p className="text-5xl font-extrabold tracking-wide">
        {result.resultType}-{result.resultIdentity}
      </p>
      <p className="text-lg font-semibold text-primary">
        {info?.title ?? ''}({identityInfo.label})
      </p>
      <p className="text-sm leading-6 text-muted">
        {info?.description ?? '診断結果を計算できませんでした。'}
      </p>
      <p className="text-sm leading-6 text-muted">{identityInfo.description}</p>

      <div className="space-y-2 text-left">
        {MBTI_AXES.map((axis) => {
          const percent = computeMbtiAxisPercent(result.scores, axis);
          return (
            <div key={axis} className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {result.roleNote ? <p className="text-xs text-muted">{result.roleNote}</p> : null}
      <p className="text-xs text-muted">簡易診断のため参考程度にご覧ください。</p>
    </div>
  );
}

function StatusCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="text-sm text-muted">{detail}</p>
    </div>
  );
}
