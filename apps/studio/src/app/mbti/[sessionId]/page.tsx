import '../mbti.css';
import type { Metadata } from 'next';
import { Brain } from 'lucide-react';
import { getMbtiWebQuizSessionRecord, resolveMbtiWebQuizSessionForAnswer } from '@herta/db';
import { createEmptyMbtiScores } from '@herta/shared/mbti-core';
import { MbtiWebQuizClient } from '@/components/mbti-web-quiz-client';
import { MbtiResultReport } from '@/components/mbti-result-report';
import { MbtiQuizLayout } from '@/components/mbti-quiz-layout';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '性格診断 | Herta',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

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
        <MbtiQuizLayout>
          <MbtiResultReport scores={{ ...createEmptyMbtiScores(), ...completed.scores }} />
        </MbtiQuizLayout>
      );
    }
    return (
      <AccessState title="この診断は既に完了しています" detail="結果を確認できませんでした。" />
    );
  }

  const { session } = resolution;
  return (
    <MbtiQuizLayout>
      <MbtiWebQuizClient
        sessionId={sessionId}
        questions={session.questionOrder}
        initialAnsweredCount={session.answers.length}
        expiresAt={session.expiresAt.toISOString()}
      />
    </MbtiQuizLayout>
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
