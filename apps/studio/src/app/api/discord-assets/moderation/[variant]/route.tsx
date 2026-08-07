import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const WIDTH = 1200;
const HEIGHT = 360;

const variants = {
  info: {
    accent: '#6D67E4',
    background: '#0E111C',
    backgroundEnd: '#242154',
    title: 'MODERATION • MONITOR',
    subtitle: 'Signal detected',
  },
  warning: {
    accent: '#D99A39',
    background: '#121018',
    backgroundEnd: '#49351E',
    title: 'MODERATION • WARNING',
    subtitle: 'Review recommended',
  },
  high: {
    accent: '#EB683A',
    background: '#140E18',
    backgroundEnd: '#55291E',
    title: 'MODERATION • HIGH RISK',
    subtitle: 'Prompt review required',
  },
  critical: {
    accent: '#EC425B',
    background: '#160C12',
    backgroundEnd: '#5A1826',
    title: 'MODERATION • CRITICAL',
    subtitle: 'Immediate action recommended',
  },
  failed: {
    accent: '#CA459A',
    background: '#130C14',
    backgroundEnd: '#4A1639',
    title: 'AUTOMATION • FAILED',
    subtitle: 'Manual review required',
  },
  case: {
    accent: '#48B3B2',
    background: '#0C1219',
    backgroundEnd: '#153E45',
    title: 'MODERATION • CASE',
    subtitle: 'Action history & evidence',
  },
} as const;

type Variant = keyof typeof variants;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ variant: string }> },
): Promise<ImageResponse | Response> {
  const { variant: rawVariant } = await params;
  if (!isVariant(rawVariant)) {
    return new Response('Not Found', { status: 404 });
  }

  const variant = variants[rawVariant];

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        color: '#FFFFFF',
        background: `linear-gradient(110deg, ${variant.background} 0%, ${variant.background} 48%, ${variant.backgroundEnd} 100%)`,
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          opacity: 0.26,
          backgroundImage:
            'radial-gradient(circle at 78% 50%, rgba(255,255,255,.34) 0 2px, transparent 3px), radial-gradient(circle at 88% 20%, rgba(255,255,255,.22) 0 1px, transparent 2px), radial-gradient(circle at 62% 28%, rgba(255,255,255,.18) 0 1px, transparent 2px)',
          backgroundSize: '74px 58px, 96px 82px, 128px 104px',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 62,
          top: 58,
          width: 8,
          height: 244,
          borderRadius: 8,
          background: variant.accent,
          boxShadow: `0 0 32px ${variant.accent}66`,
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          left: 98,
          top: 62,
          width: 720,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 38,
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: '-0.03em',
          }}
        >
          HERTA
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 12,
            fontSize: 25,
            lineHeight: 1,
            fontWeight: 500,
            color: variant.accent,
            letterSpacing: '0.02em',
          }}
        >
          DISCORD AUTOMATION
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 50,
            fontSize: 70,
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: '-0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          {variant.title}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 20,
            fontSize: 24,
            color: '#D6D7E4',
            letterSpacing: '0.01em',
          }}
        >
          {variant.subtitle}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 112,
          top: 58,
          width: 246,
          height: 246,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `3px solid ${variant.accent}AA`,
          borderRadius: 999,
          boxShadow: `0 0 70px ${variant.accent}22`,
        }}
      >
        <div
          style={{
            width: 172,
            height: 172,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${variant.accent}99`,
            borderRadius: 999,
          }}
        >
          <div
            style={{
              width: 104,
              height: 104,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: 'rotate(45deg)',
              border: `2px solid ${variant.accent}DD`,
              background: `${variant.accent}22`,
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                display: 'flex',
                borderRadius: 999,
                background: '#FFFFFF',
                transform: 'rotate(-45deg)',
                boxShadow: `0 0 30px ${variant.accent}`,
              }}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 64,
          top: 42,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 92,
          height: 38,
          padding: '0 20px',
          border: '1px solid rgba(255,255,255,.16)',
          borderRadius: 999,
          background: 'rgba(255,255,255,.08)',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'rgba(255,255,255,.82)',
        }}
      >
        v2
      </div>
    </div>,
    {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
}

function isVariant(value: string): value is Variant {
  return Object.prototype.hasOwnProperty.call(variants, value);
}
