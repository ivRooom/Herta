import '../mbti.css';
import type { Metadata } from 'next';
import { parseMbtiShareScores } from '@herta/shared/mbti-report';
import { MbtiQuizLayout } from '@/components/mbti-quiz-layout';
import { MbtiResultReport } from '@/components/mbti-result-report';

export const metadata: Metadata = {
  title: '性格診断レポート | Herta',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function SharedMbtiResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }
  const scores = parseMbtiShareScores(params);
  return (
    <MbtiQuizLayout>
      {scores ? (
        <MbtiResultReport scores={scores} shared />
      ) : (
        <div className="mbti-report-intro">
          <h2>共有リンクが正しくありません</h2>
          <p>レポート画面からリンクをもう一度コピーしてください。</p>
        </div>
      )}
    </MbtiQuizLayout>
  );
}
