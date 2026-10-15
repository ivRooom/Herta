import { Brain } from 'lucide-react';
import { getMbtiWebQuizSessionRecord, resolveMbtiWebQuizSessionForAnswer } from '@herta/db';
import {
  computeMbtiAxisPercent,
  MBTI_AXES,
  MBTI_IDENTITY_INFO,
  MBTI_TYPES,
  createEmptyMbtiScores,
  type MbtiScores,
} from '@herta/shared/mbti-core';
import { MbtiWebQuizClient } from '@/components/mbti-web-quiz-client';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export default async function MbtiWebQuizPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  if (!UUID_PATTERN.test(sessionId)) {
    return (
      <AccessState title="リンクが正しくありません" detail="共有URLをもう一度確認してください。" />
    );
  }

  const resolution = await resolveMbtiWebQuizSessionForAnswer(prisma, sessionId);
  if (!resolution.ok) {
    if (resolution.reason === 'not_found') {
      return (
        <AccessState
          title="リンクが無効です"
          detail="このリンクは存在しないか、無効になっています。"
        />
      );
    }
    if (resolution.reason === 'expired') {
      return (
        <AccessState
          title="リンクの有効期限が切れました"
          detail="Discordで`/mbti`をもう一度実行し、新しいリンクを発行してください。"
        />
      );
    }
    // already_completed: 保存済みの結果をそのまま再表示する(再アクセスをエラーにしない)。
    const completed = await getMbtiWebQuizSessionRecord(prisma, sessionId);
    if (completed?.resultType && completed.resultIdentity) {
      return (
        <QuizLayout>
          <CompletedResultView
            resultType={completed.resultType}
            resultIdentity={completed.resultIdentity as 'A' | 'T'}
            scores={{ ...createEmptyMbtiScores(), ...completed.scores }}
          />
        </QuizLayout>
      );
    }
    return (
      <AccessState title="この診断は既に完了しています" detail="結果を確認できませんでした。" />
    );
  }

  const { session } = resolution;
  return (
    <QuizLayout>
      <MbtiWebQuizClient
        sessionId={sessionId}
        questions={session.questionOrder}
        initialAnsweredCount={session.answers.length}
      />
    </QuizLayout>
  );
}

function QuizLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-xl space-y-5">
        <section className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-7">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Brain className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Herta MBTI
              </p>
              <h1 className="mt-1 text-lg font-semibold">MBTI風性格診断</h1>
            </div>
          </div>
          <div className="mt-5">{children}</div>
        </section>
      </div>
    </main>
  );
}

function CompletedResultView({
  resultType,
  resultIdentity,
  scores,
}: {
  resultType: string;
  resultIdentity: 'A' | 'T';
  scores: MbtiScores;
}) {
  const info = MBTI_TYPES[resultType];
  const identityInfo = MBTI_IDENTITY_INFO[resultIdentity];

  return (
    <div className="space-y-5 text-center">
      <p className="text-5xl font-extrabold tracking-wide">
        {resultType}-{resultIdentity}
      </p>
      <p className="text-lg font-semibold text-primary">
        {info?.title ?? ''}({identityInfo.label})
      </p>
      <p className="text-sm leading-6 text-muted">{info?.description ?? ''}</p>
      <p className="text-sm leading-6 text-muted">{identityInfo.description}</p>
      <div className="space-y-2 text-left">
        {MBTI_AXES.map((axis) => (
          <div key={axis} className="h-2 w-full overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${computeMbtiAxisPercent(scores, axis)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function AccessState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-border bg-surface p-6 text-center shadow-card sm:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Brain className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{detail}</p>
      </section>
    </main>
  );
}
