import '../mbti.css';
import type { Metadata } from 'next';
import { parseMbtiShareScores } from '@herta/shared/mbti-report';
import { MbtiQuizLayout } from '@/components/mbti-quiz-layout';
import { MbtiResultReport } from '@/components/mbti-result-report';
import {
  MBTI_SHARE_IMAGE_SIZE,
  mbtiShareImagePath,
  mbtiShareMetadataText,
} from '@/lib/mbti-share-preview';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toSearchParams(raw: Awaited<SearchParams>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }
  return params;
}

function publicOrigin(): URL | undefined {
  try {
    const url = new URL(process.env['NEXTAUTH_URL']?.trim() ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? new URL(url.origin) : undefined;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = toSearchParams(await searchParams);
  const scores = parseMbtiShareScores(params);
  const estimated = scores !== null && params.get('basis') === 'estimate';
  const { title, description } = mbtiShareMetadataText(scores, estimated);
  const image = {
    url: mbtiShareImagePath(scores, estimated),
    ...MBTI_SHARE_IMAGE_SIZE,
    alt: title,
  };
  return {
    metadataBase: publicOrigin(),
    title,
    description,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    openGraph: { type: 'website', siteName: 'Herta', title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function SharedMbtiResultPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = toSearchParams(await searchParams);
  const scores = parseMbtiShareScores(params);
  return (
    <MbtiQuizLayout>
      {scores ? (
        <MbtiResultReport scores={scores} shared estimated={params.get('basis') === 'estimate'} />
      ) : (
        <div className="mbti-report-intro">
          <h2>共有リンクが正しくありません</h2>
          <p>レポート画面からリンクをもう一度コピーしてください。</p>
        </div>
      )}
    </MbtiQuizLayout>
  );
}
