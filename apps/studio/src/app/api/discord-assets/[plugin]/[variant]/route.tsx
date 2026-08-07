import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const WIDTH = 1200;
const HEIGHT = 360;

const PLUGINS = {
  lfg: {
    label: 'LOOKING FOR GROUP',
    accent: '#5CC8A1',
    background: '#0C1316',
    backgroundEnd: '#164838',
  },
  'team-split': {
    label: 'TEAM SPLIT',
    accent: '#66A7FF',
    background: '#0C1119',
    backgroundEnd: '#183A65',
  },
  quote: {
    label: 'QUOTE',
    accent: '#B48CFF',
    background: '#100D17',
    backgroundEnd: '#3A285D',
  },
  'auto-response': {
    label: 'AUTO RESPONSE',
    accent: '#EF8E69',
    background: '#15100D',
    backgroundEnd: '#5A3021',
  },
  'daily-content': {
    label: 'DAILY CONTENT',
    accent: '#F0C866',
    background: '#15130C',
    backgroundEnd: '#59491A',
  },
} as const;

const VARIANT_LABELS: Record<string, string> = {
  open: 'OPEN',
  created: 'CREATED',
  full: 'FULL',
  closed: 'CLOSED',
  joined: 'JOINED',
  split: 'RESULT',
  result: 'RESULT',
  reroll: 'REROLL',
  success: 'SUCCESS',
  info: 'INFO',
  warning: 'WARNING',
  failed: 'FAILED',
};

type Plugin = keyof typeof PLUGINS;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ plugin: string; variant: string }> },
): Promise<ImageResponse | Response> {
  const { plugin: rawPlugin, variant: rawVariant } = await params;
  if (!isPlugin(rawPlugin) || !isSafeVariant(rawVariant)) {
    return new Response('Not Found', { status: 404 });
  }

  const plugin = PLUGINS[rawPlugin];
  const variant = VARIANT_LABELS[rawVariant] ?? rawVariant.replaceAll('-', ' ').toUpperCase();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        color: '#FFFFFF',
        background: `linear-gradient(110deg, ${plugin.background} 0%, ${plugin.background} 48%, ${plugin.backgroundEnd} 100%)`,
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          opacity: 0.22,
          backgroundImage:
            'radial-gradient(circle at 78% 50%, rgba(255,255,255,.32) 0 2px, transparent 3px), radial-gradient(circle at 88% 20%, rgba(255,255,255,.20) 0 1px, transparent 2px), radial-gradient(circle at 62% 28%, rgba(255,255,255,.16) 0 1px, transparent 2px)',
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
          background: plugin.accent,
          boxShadow: `0 0 32px ${plugin.accent}66`,
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
        <div style={{ display: 'flex', fontSize: 38, lineHeight: 1, fontWeight: 800 }}>HERTA</div>
        <div
          style={{
            display: 'flex',
            marginTop: 12,
            fontSize: 25,
            lineHeight: 1,
            fontWeight: 600,
            color: plugin.accent,
            letterSpacing: '0.03em',
          }}
        >
          {plugin.label}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 50,
            fontSize: 74,
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: '-0.04em',
          }}
        >
          {variant}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 20,
            fontSize: 24,
            color: '#D6D7E4',
          }}
        >
          Herta Discord Visual System
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
          border: `3px solid ${plugin.accent}AA`,
          borderRadius: 999,
          boxShadow: `0 0 70px ${plugin.accent}22`,
        }}
      >
        <div
          style={{
            width: 172,
            height: 172,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${plugin.accent}99`,
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
              border: `2px solid ${plugin.accent}DD`,
              background: `${plugin.accent}22`,
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
                boxShadow: `0 0 30px ${plugin.accent}`,
              }}
            />
          </div>
        </div>
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

function isPlugin(value: string): value is Plugin {
  return Object.prototype.hasOwnProperty.call(PLUGINS, value);
}

function isSafeVariant(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/u.test(value);
}
