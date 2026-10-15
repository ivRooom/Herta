'use client';

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { MbtiResultReport } from './mbti-result-report';
import {
  MBTI_LIKERT_ANSWERS,
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
  expiresAt,
}: {
  sessionId: string;
  questions: QuizQuestion[];
  initialAnsweredCount: number;
  expiresAt?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialAnsweredCount);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<MbtiLikertAnswer | null>(null);
  const requestInFlight = useRef(false);
  const completing = useRef(false);
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

  if (result) return <MbtiResultReport scores={result.scores} roleNote={result.roleNote} />;

  if (!question) {
    return error ? (
      <div>
        <StatusCard title="診断結果を計算できませんでした" detail={error} />
        <button type="button" className="mbti-retry" onClick={() => setError(null)}>
          結果の表示を再試行
        </button>
      </div>
    ) : (
      <StatusCard title="結果を計算しています…" detail="少々お待ちください。" />
    );
  }

  async function answer(value: MbtiLikertAnswer) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setSelected(value);
    setSubmitting(true);
    setError(null);
    try {
      const feedback = new Promise<void>((resolve) => window.setTimeout(resolve, 240));
      const response = await fetch(`/api/mbti/${sessionId}/answer`, {
        method: 'POST',
        keepalive: true,
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

      await feedback;
      if (payload.isLastQuestion) {
        setCurrentIndex(questions.length);
        await complete();
        return;
      }
      setCurrentIndex(payload.nextQuestionIndex ?? currentIndex + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '回答を送信できませんでした');
    } finally {
      requestInFlight.current = false;
      setSubmitting(false);
      setSelected(null);
    }
  }

  async function complete() {
    if (completing.current) return;
    completing.current = true;
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
    } finally {
      completing.current = false;
    }
  }

  const progress = Math.round((currentIndex / questions.length) * 100);

  return (
    <div className="mbti-quiz" aria-busy={submitting}>
      <div
        className="mbti-progress"
        role="progressbar"
        aria-label="診断の進捗"
        aria-valuemin={0}
        aria-valuemax={questions.length}
        aria-valuenow={currentIndex}
      >
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="mbti-progress-label">
        <span>
          {currentIndex + 1} / {questions.length}
        </span>
        <span>{progress}%</span>
      </div>
      <p className="mbti-save-status" role="status">
        {submitting
          ? '保存しています…'
          : `${currentIndex}問の回答を保存済み。同じリンクから続けられます。`}
      </p>
      {expiresAt ? (
        <p className="mbti-save-expiry">
          再開期限：
          {new Intl.DateTimeFormat('ja-JP', {
            timeZone: 'Asia/Tokyo',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(expiresAt))}
          （日本時間）
        </p>
      ) : null}
      <div key={question.id} className="mbti-question-step">
        <h2 className="mbti-question" aria-live="polite">
          {question.prompt}
        </h2>
        <div className="mbti-answers" role="group" aria-label="当てはまり方を選んでください">
          {MBTI_LIKERT_ANSWERS.map((value, index) => (
            <button
              key={value}
              type="button"
              disabled={submitting}
              onClick={() => void answer(value)}
              aria-pressed={selected === value}
              className={`mbti-answer mbti-answer-${index}${selected === value ? ' is-selected' : ''}`}
            >
              <span className="mbti-answer-circle" aria-hidden="true">
                <Check />
              </span>
              <span className="mbti-answer-label">{mbtiLikertLabel(value)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mbti-quiz-footer">
        <p role="status">{submitting ? '回答を送信しています…' : '直感で、あなたらしく。'}</p>
        <div className="mbti-milestones" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={i <= Math.floor((currentIndex / questions.length) * 12) ? 'is-filled' : ''}
            />
          ))}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-center text-sm text-red-400">
          {error}
        </p>
      ) : null}
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
