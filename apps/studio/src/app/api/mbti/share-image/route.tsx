import { ImageResponse } from 'next/og';
import { parseMbtiShareScores } from '@herta/shared/mbti-report';
import {
  MBTI_SHARE_IMAGE_SIZE,
  MBTI_SHARE_IMAGE_TEXT,
  createMbtiSharePreview,
  type MbtiSharePreview,
} from '@/lib/mbti-share-preview';

export const runtime = 'edge';

const BACKGROUND = '#17162a';
const BACKGROUND_END = '#2a2347';
const MINT = '#9af3d5';
const LILAC = '#c9a6f5';
const TEXT = '#f5f6fa';
const MUTED = '#b9c4d6';

const PADDING_X = 72;
const LEFT_COLUMN_WIDTH = 440;
const COLUMN_GAP = 40;
// satoriは%幅の解決が不安定なため、軸バーはpx固定で描く。
const AXIS_WIDTH = MBTI_SHARE_IMAGE_SIZE.width - PADDING_X * 2 - LEFT_COLUMN_WIDTH - COLUMN_GAP;

const AXIS_COLORS: Record<string, string> = {
  EI: '#f97316',
  SN: '#22c55e',
  TF: '#38bdf8',
  JP: '#a855f7',
  AT: '#ec4899',
};

// 描画する文字だけを収録したNoto Sans JPのsubset(SIL OFL 1.1)。実行時に外部へ取得しない。
const regularFont = fetch(new URL('./NotoSansJP-Regular-subset.ttf', import.meta.url)).then(
  (response) => response.arrayBuffer(),
);
const boldFont = fetch(new URL('./NotoSansJP-ExtraBold-subset.ttf', import.meta.url)).then(
  (response) => response.arrayBuffer(),
);

export async function GET(request: Request): Promise<ImageResponse> {
  const params = new URL(request.url).searchParams;
  const scores = parseMbtiShareScores(params);
  const preview = scores
    ? createMbtiSharePreview(scores, params.get('basis') === 'estimate')
    : null;
  const [regular, bold] = await Promise.all([regularFont, boldFont]);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        color: TEXT,
        background: `linear-gradient(120deg, ${BACKGROUND} 0%, ${BACKGROUND} 45%, ${BACKGROUND_END} 100%)`,
        fontFamily: 'Noto Sans JP',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          opacity: 0.18,
          backgroundImage:
            'radial-gradient(circle at 82% 18%, rgba(255,255,255,.4) 0 1px, transparent 2px), radial-gradient(circle at 64% 78%, rgba(255,255,255,.3) 0 1px, transparent 2px)',
          backgroundSize: '90px 70px, 130px 110px',
        }}
      />
      {preview ? <ResultCard preview={preview} /> : <FallbackCard />}
      <div
        style={{
          position: 'absolute',
          left: PADDING_X,
          bottom: 48,
          display: 'flex',
          fontSize: 24,
          color: MUTED,
        }}
      >
        {MBTI_SHARE_IMAGE_TEXT.footer}
      </div>
    </div>,
    {
      ...MBTI_SHARE_IMAGE_SIZE,
      fonts: [
        { name: 'Noto Sans JP', data: regular, weight: 400, style: 'normal' },
        { name: 'Noto Sans JP', data: bold, weight: 800, style: 'normal' },
      ],
      headers: {
        // 画像はクエリだけで決まるため、同じ共有URLには長くキャッシュしてよい。
        'Cache-Control': preview
          ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800'
          : 'public, max-age=3600, s-maxage=86400',
        'X-Robots-Tag': 'noindex',
      },
    },
  );
}

function Brand({ estimated }: { estimated: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div
        style={{
          display: 'flex',
          fontSize: 28,
          fontWeight: 800,
          color: MINT,
          letterSpacing: '0.04em',
        }}
      >
        {MBTI_SHARE_IMAGE_TEXT.brand}
      </div>
      {estimated ? (
        <div
          style={{
            display: 'flex',
            marginLeft: 16,
            padding: '4px 14px',
            borderRadius: 999,
            border: `2px solid ${LILAC}`,
            color: LILAC,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {MBTI_SHARE_IMAGE_TEXT.estimatedBadge}
        </div>
      ) : null}
    </div>
  );
}

function ResultCard({ preview }: { preview: MbtiSharePreview }) {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', padding: `64px ${PADDING_X}px` }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: LEFT_COLUMN_WIDTH }}>
        <Brand estimated={preview.estimated} />
        <div
          style={{
            display: 'flex',
            marginTop: 56,
            fontSize: 112,
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          {preview.code}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 60,
            lineHeight: 1.1,
            fontWeight: 800,
            color: LILAC,
          }}
        >
          {preview.title}
        </div>
        <div style={{ display: 'flex', marginTop: 18, fontSize: 30, color: MUTED }}>
          {preview.identityLabel}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: AXIS_WIDTH,
          marginLeft: COLUMN_GAP,
        }}
      >
        {preview.axes.map((axis) => (
          <AxisRow key={axis.axis} axis={axis} />
        ))}
      </div>
    </div>
  );
}

function AxisRow({ axis }: { axis: MbtiSharePreview['axes'][number] }) {
  const color = AXIS_COLORS[axis.axis] ?? MINT;
  const label = (index: 0 | 1) => (
    <div
      style={{
        display: 'flex',
        fontSize: 24,
        fontWeight: axis.side === index ? 800 : 400,
        color: axis.side === index ? TEXT : MUTED,
      }}
    >
      {axis.labels[index]}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: AXIS_WIDTH, marginBottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        {label(0)}
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, color }}>
          {axis.balanced ? `${MBTI_SHARE_IMAGE_TEXT.balanced} ` : ''}
          {`${axis.percent}%`}
        </div>
        {label(1)}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 10,
          width: AXIS_WIDTH,
          height: 18,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.12)',
          justifyContent: axis.side === 0 ? 'flex-start' : 'flex-end',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: Math.round((AXIS_WIDTH * axis.percent) / 100),
            height: 18,
            borderRadius: 999,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

function FallbackCard() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: `64px ${PADDING_X}px`,
      }}
    >
      <Brand estimated={false} />
      <div
        style={{
          display: 'flex',
          marginTop: 40,
          fontSize: 88,
          fontWeight: 800,
          lineHeight: 1.1,
        }}
      >
        {MBTI_SHARE_IMAGE_TEXT.fallbackTitle}
      </div>
      <div style={{ display: 'flex', marginTop: 24, fontSize: 36, color: MUTED }}>
        {MBTI_SHARE_IMAGE_TEXT.fallbackSubtitle}
      </div>
    </div>
  );
}
