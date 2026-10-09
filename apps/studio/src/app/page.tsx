import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import localFont from 'next/font/local';
import {
  Activity,
  ArrowRight,
  Bot,
  Cake,
  ChevronRight,
  Gamepad2,
  MessagesSquare,
  Puzzle,
  ShieldCheck,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { getAllPluginManifests } from '@herta/plugin-catalog';
import { auth } from '@/auth';
import { DiscordIcon } from '@/components/discord-icon';
import { CommandPalette, type PaletteCommand } from '@/components/landing/command-palette';
import { CountUp } from '@/components/landing/count-up';
import { HeroSpot } from '@/components/landing/hero-spot';
import { Chars } from '@/components/landing/kinetic';
import { PageLoader } from '@/components/landing/page-loader';
import {
  PluginExplorer,
  type ExplorerCategory,
  type ExplorerPlugin,
} from '@/components/landing/plugin-explorer';
import { Reveal } from '@/components/landing/reveal';
import { ScrambleText } from '@/components/landing/scramble-text';
import { ScrollFx } from '@/components/landing/scroll-fx';
import { ScrollScale } from '@/components/landing/scroll-scale';
import { ScrollText } from '@/components/landing/scroll-text';
import { StudioScrolly } from '@/components/landing/studio-scrolly';
import { TiltCard } from '@/components/landing/tilt-card';
import { signInWithDiscord } from '@/lib/actions';
import './landing.css';

// セッションによって表示(CTA)が変わるため静的化しない。
export const dynamic = 'force-dynamic';

// フォントはリポジトリに含めている (ビルド時に外部へ接続しない)。詳細は ./fonts/README.md
const geist = localFont({
  src: './fonts/Geist-latin.woff2',
  weight: '100 900',
  variable: '--font-geist',
  display: 'swap',
});
const geistMono = localFont({
  src: './fonts/GeistMono-latin.woff2',
  weight: '100 900',
  variable: '--font-geist-mono',
  display: 'swap',
});

/* ---------- 実データ: 公式Pluginカタログ ---------- */

const MANIFESTS = getAllPluginManifests();

const CATEGORIES: readonly ExplorerCategory[] = [
  { id: 'moderation', label: 'モデレーション' },
  { id: 'utility', label: 'ユーティリティ' },
  { id: 'fun', label: 'エンタメ' },
  { id: 'game', label: 'ゲーム' },
  { id: 'analytics', label: '分析' },
];

const PLUGINS: readonly ExplorerPlugin[] = MANIFESTS.map((manifest) => ({
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  category: manifest.category,
  commandCount: manifest.commands.length,
}));

/** デモで最初に見せたいコマンド。実在するものだけが先頭に来て、自動入力にも使われる。 */
const SPOTLIGHT_COMMANDS = ['leaderboard', 'lfg', 'giveaway', 'valorant', 'poll'] as const;

const COMMANDS: readonly PaletteCommand[] = (() => {
  const all = MANIFESTS.flatMap((manifest) =>
    manifest.commands.map((command) => ({
      name: command.name,
      description: command.description,
      pluginName: manifest.name,
    })),
  );
  const rank = (name: string) => {
    const at = SPOTLIGHT_COMMANDS.indexOf(name as (typeof SPOTLIGHT_COMMANDS)[number]);
    return at === -1 ? SPOTLIGHT_COMMANDS.length : at;
  };
  return [...all].sort((a, b) => rank(a.name) - rank(b.name));
})();

const AUTOPLAY_COMMANDS = SPOTLIGHT_COMMANDS.filter((name) =>
  COMMANDS.some((command) => command.name === name),
).slice(0, 3);

/* ---------- 機能 (ベントー) ---------- */

/** 機能カードと、それを支える公式Pluginの対応。件数はカタログの実データから数える。 */
const MODULES: Record<string, { plugins: readonly string[]; accent: string }> = {
  モデレーション: {
    plugins: ['moderation', 'activity-log', 'channel-policy', 'activity-rules'],
    accent: 'var(--pink)',
  },
  '自動化と Plugin': {
    plugins: ['auto-response', 'daily-content', 'onboarding', 'role-manager'],
    accent: 'var(--cyan)',
  },
  'XP と Achievements': {
    plugins: ['xp-level', 'achievements', 'community-profile', 'community-challenge'],
    accent: 'var(--pink)',
  },
  アクティビティ分析: {
    plugins: ['server-stats', 'activity-log', 'activity-rules'],
    accent: 'var(--cyan)',
  },
  募集とイベント: {
    plugins: ['lfg', 'team-split', 'poll', 'giveaway', 'event-rsvp'],
    accent: 'var(--purple-deep)',
  },
  ゲームと診断: { plugins: ['mini-games', 'mbti', 'valorant'], accent: 'var(--pink)' },
  Birthday: { plugins: ['birthday-role'], accent: 'var(--yellow)' },
  AI: { plugins: ['ai'], accent: 'var(--cyan)' },
  ユーティリティ: { plugins: ['reminder', 'afk', 'suggestion', 'quote'], accent: 'var(--yellow)' },
};

function moduleStats(title: string) {
  const entry = MODULES[title];
  const found = MANIFESTS.filter((manifest) => entry?.plugins.includes(manifest.id));
  return {
    plugins: found.length,
    commands: found.reduce((total, manifest) => total + manifest.commands.length, 0),
    accent: entry?.accent ?? 'var(--cyan)',
  };
}
const MAX_MODULE_PLUGINS = Math.max(
  ...Object.keys(MODULES).map((title) => moduleStats(title).plugins),
);

type Tone = 'dark' | 'accent' | 'light' | 'pink' | 'cyan' | 'yellow';

interface Feature {
  title: string;
  description: string;
  tags: readonly string[];
  icon: LucideIcon;
  tone: Tone;
  /** lg以上での占有カラム数 (全体は3カラム) */
  span: 1 | 2;
  viz?: 'moderation' | 'xp' | 'analytics' | 'plugins';
}

const FEATURES: readonly Feature[] = [
  {
    title: 'モデレーション',
    description: '荒らしやスパム、NGワードを検知して自動で対応。ケース管理と監査ログも残ります。',
    tags: ['検知ルール', 'ケース管理', '監査ログ', 'チャンネルポリシー'],
    icon: ShieldCheck,
    tone: 'dark',
    span: 2,
    viz: 'moderation',
  },
  {
    title: '自動化と Plugin',
    description: '必要な Plugin だけをサーバーごとにON。設定の変更は履歴に残り、あとから戻せます。',
    tags: ['Auto Response', '予約・定期投稿', 'ルールエンジン'],
    icon: Puzzle,
    tone: 'accent',
    span: 1,
    viz: 'plugins',
  },
  {
    title: 'XP と Achievements',
    description: '発言やVCでXPが貯まり、レベルに応じてロールや称号がもらえます。',
    tags: ['/leaderboard', '報酬ロール', 'Achievements'],
    icon: Trophy,
    tone: 'yellow',
    span: 1,
    viz: 'xp',
  },
  {
    title: 'アクティビティ分析',
    description: '発言・リアクション・VC・オンライン時間を、好きな期間で集計して見られます。',
    tags: ['DAU / WAU / MAU', 'チャンネル別', '/community-stats', '/activity-export'],
    icon: Activity,
    tone: 'dark',
    span: 2,
    viz: 'analytics',
  },
  {
    title: '募集とイベント',
    description: '遊ぶ相手の募集、チーム分け、投票、プレゼント企画までDiscordの中で完結します。',
    tags: ['/lfg', 'チーム分け', 'Poll', '/giveaway'],
    icon: Users,
    tone: 'pink',
    span: 1,
  },
  {
    title: 'ゲームと診断',
    description: 'ミニゲームやMBTI診断、VALORANTの戦績確認など、雑談が盛り上がる機能です。',
    tags: ['ミニゲーム', 'MBTI診断', '/valorant', 'Akinator'],
    icon: Gamepad2,
    tone: 'cyan',
    span: 1,
  },
  {
    title: 'Birthday',
    description: 'メンバーが自分で誕生日を登録。お祝いカードのデザインも管理画面で作れます。',
    tags: ['登録ページ', 'Birthday Card', 'Birthday Role'],
    icon: Cake,
    tone: 'dark',
    span: 1,
  },
  {
    title: 'AI',
    description: '会話、画像生成、コード実行、天気の確認。使うAIプロバイダも管理画面で設定します。',
    tags: ['AI会話', '画像生成', 'コード実行', '天気'],
    icon: Bot,
    tone: 'light',
    span: 1,
  },
  {
    title: 'ユーティリティ',
    description: 'リマインダーやAFK、サーバー情報の確認、ロールの管理など日々の細かい作業向け。',
    tags: ['/help', 'Reminder', 'AFK', 'Role Manager'],
    icon: MessagesSquare,
    tone: 'dark',
    span: 2,
  },
];

const TONE: Record<Tone, { tile: string; body: string; tag: string }> = {
  dark: {
    tile: 'border border-[var(--line)] bg-[var(--surface)]',
    body: 'text-[var(--muted)]',
    tag: 'border border-[var(--line)] text-[var(--muted)]',
  },
  accent: {
    tile: 'bg-[var(--purple-deep)] text-white',
    body: 'text-white/75',
    tag: 'bg-white/15 text-white',
  },
  light: {
    tile: 'bg-[#f4f4f6] text-[#0c0c0e]',
    body: 'text-[#55555e]',
    tag: 'bg-black/[0.07] text-[#2a2a31]',
  },
  pink: {
    tile: 'bg-[var(--pink)] text-[var(--pop-ink)]',
    body: 'text-[#14091f] opacity-80',
    tag: 'bg-black/15 text-[#14091f]',
  },
  cyan: {
    tile: 'bg-[var(--cyan)] text-[var(--pop-ink)]',
    body: 'text-[#14091f] opacity-80',
    tag: 'bg-black/15 text-[#14091f]',
  },
  yellow: {
    tile: 'bg-[var(--yellow)] text-[var(--pop-ink)]',
    body: 'text-[#14091f] opacity-80',
    tag: 'bg-black/15 text-[#14091f]',
  },
};

/** 明るい面のずらし影の色。暗い面には影をつけず、代わりに色付きの上辺をつける。 */
const TILE_SHADOW: Partial<Record<Tone, string>> = {
  accent: 'var(--cyan)',
  light: 'var(--purple)',
  pink: 'var(--purple-deep)',
  cyan: 'var(--pink)',
  yellow: 'var(--pink)',
};

/** 明るい面(黄・水色・ピンクなど)の上では、図の配色を反転させる */
const LIGHT_TONES: readonly Tone[] = ['pink', 'cyan', 'yellow', 'light'];

/** 面の中の小さな図。表示されたときに1回だけ動き、JS無効では完成形のまま表示される。 */
function VizFrame({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <div
      className={`mt-6 rounded-xl border p-4 ${light ? 'border-black/15 bg-black/10' : 'border-white/[0.08] bg-black/25'}`}
      aria-hidden="true"
    >
      <p
        className={`lp-mono mb-3 text-[10px] font-bold tracking-widest ${light ? 'text-black/45' : 'text-white/35'}`}
      >
        PREVIEW
      </p>
      {children}
    </div>
  );
}

function Viz({ kind, light = false }: { kind: NonNullable<Feature['viz']>; light?: boolean }) {
  if (kind === 'moderation') {
    return (
      <VizFrame>
        <div className="space-y-2 text-[13px]">
          {[
            { text: '今日のイベント、何時からですか？', spam: false },
            { text: '無料ギフト配布中 discord.gg/xxxxxx', spam: true },
            { text: 'ありがとうございます！', spam: false },
          ].map((row) => (
            <div
              key={row.text}
              className="flex items-center gap-2.5 rounded-lg bg-white/[0.05] px-3 py-2"
            >
              <span className="h-5 w-5 shrink-0 rounded-full bg-white/15" />
              <span className={row.spam ? 'viz-strike text-white/70' : 'text-white/70'}>
                {row.text}
              </span>
              {row.spam ? (
                <span className="viz-badge lp-mono ml-auto shrink-0 rounded bg-[#ff6b6b]/15 px-1.5 py-0.5 text-[10px] text-[#ff8a8a]">
                  DELETED
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </VizFrame>
    );
  }
  if (kind === 'xp') {
    return (
      <VizFrame light={light}>
        <div className="flex items-end justify-between">
          <p className="text-4xl font-semibold tracking-tight">
            Lv.
            <span className={light ? 'text-[var(--purple-deep)]' : 'text-[var(--purple)]'}>12</span>
          </p>
          <p className="lp-mono text-[11px] text-black/55">72%</p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/15">
          <div className="viz-fill h-full w-[72%] origin-left rounded-full bg-[var(--purple-deep)]" />
        </div>
      </VizFrame>
    );
  }
  if (kind === 'analytics') {
    const bars = [38, 52, 44, 68, 60, 82, 74, 91, 66, 78, 96, 88];
    return (
      <VizFrame>
        <div className="flex h-24 items-end gap-1.5">
          {bars.map((height, i) => (
            <div
              key={i}
              className="viz-bar flex-1 rounded-t-sm bg-[var(--purple)] opacity-80"
              style={{ height: `${height}%`, '--i': String(i) } as CSSProperties}
            />
          ))}
        </div>
      </VizFrame>
    );
  }
  return (
    <VizFrame>
      <div className="space-y-2.5">
        {[true, true, false].map((on, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="h-2 rounded-full bg-white/25" style={{ width: `${70 - i * 14}%` }} />
            <span
              className={`relative h-5 w-9 overflow-hidden rounded-full ${on ? 'bg-white' : 'bg-white/25'}`}
            >
              <span
                className={`viz-knob absolute top-0.5 h-4 w-4 rounded-full ${
                  on ? 'right-0.5 bg-[var(--purple-deep)]' : 'left-0.5 bg-white'
                }`}
                style={{ '--i': String(i) } as CSSProperties}
              />
            </span>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

const STEPS = [
  { title: 'Discordでログイン', body: '自分が管理者のサーバーだけが一覧に並びます。' },
  {
    title: '使いたい機能をON',
    body: 'Pluginをトグルで切り替えるだけ。設定はあとから変えられます。',
  },
  { title: 'あとはおまかせ', body: '検知も集計もお祝いも、サーバーの中で自動で動きます。' },
] as const;

function vars(values: Record<string, string>): CSSProperties {
  return values as CSSProperties;
}

/** きらめく星 (装飾。表示時に1回だけ回りながら現れる) */
function Sparkle({ className, delay }: { className: string; delay: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`lp-star pointer-events-none absolute hidden sm:block ${className}`}
      style={vars({ '--lp-d': delay })}
    >
      <path
        d="M12 0c.9 6.4 5.6 11.1 12 12-6.4.9-11.1 5.6-12 12-.9-6.4-5.6-11.1-12-12C6.4 11.1 11.1 6.4 12 0z"
        fill="currentColor"
      />
    </svg>
  );
}

/** セクションの見出し上に付ける、斜めのリボンラベル */
function Ribbon({ color, children }: { color: string; children: string }) {
  return (
    <span className="lp-ribbon lp-mono" style={{ backgroundColor: color }}>
      <span>
        <ScrambleText text={children} />
      </span>
    </span>
  );
}

/**
 * 読み込み表示の要否を、画面が描画される前に決めるための小さなスクリプト。
 * - 同じタブで2回目以降 → lp-seen (読み込み表示を出さない)
 * - 初回 → lp-loading (表示中はヒーローの出現を待たせる)。念のため6秒で必ず解除する。
 * JSが動かない環境では何も付かず、読み込み表示は <noscript> のスタイルで隠れる。
 */
const LOADER_BOOT_SCRIPT = `(function(){try{var r=document.currentScript.parentElement;if(sessionStorage.getItem('lp-seen')){r.classList.add('lp-seen');return;}r.classList.add('lp-loading');setTimeout(function(){r.classList.remove('lp-loading')},6000)}catch(e){}})()`;

const BAND_WORDS = [
  'MODERATION',
  'XP & LEVEL',
  'ANALYTICS',
  'GIVEAWAY',
  'LFG',
  'BIRTHDAY',
  'POLL',
  'AUTO RESPONSE',
  'AI',
] as const;

const HEADLINE_1 = 'サーバーの面倒ごとは、';
const HEADLINE_2 = 'Hertaにまかせて。';

export default async function HomePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  const primaryCta = isLoggedIn ? (
    <Link
      href="/dashboard"
      className="lp-hard inline-flex items-center gap-2 rounded-full border-2 border-white bg-[var(--yellow)] px-7 py-3.5 text-base font-black text-[var(--pop-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
    >
      ダッシュボードを開く
      <ArrowRight className="lp-nudge h-4 w-4" aria-hidden="true" />
    </Link>
  ) : (
    <form action={signInWithDiscord}>
      <input type="hidden" name="callbackUrl" value="/dashboard" />
      <button
        type="submit"
        className="lp-hard inline-flex items-center gap-2.5 rounded-full border-2 border-white bg-[#5865F2] px-7 py-3.5 text-base font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
      >
        <DiscordIcon className="h-5 w-5" />
        Discordでログイン
        <ArrowRight className="lp-nudge h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );

  return (
    <main
      className={`lp-root lp-grain min-h-screen overflow-x-clip ${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: LOADER_BOOT_SCRIPT }} />
      <noscript>
        <style>{'.lp-loader{display:none!important}'}</style>
      </noscript>
      <PageLoader />
      <ScrollFx />

      {/* ---------- ナビゲーション ---------- */}
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgb(8_8_10/0.7)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6 lg:px-8">
          <p className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-[3px] bg-[var(--purple)]"
            />
            Herta
          </p>
          <nav aria-label="メイン" className="flex items-center gap-6 text-[13px]">
            <a
              href="#features"
              className="hidden text-[var(--muted)] transition hover:text-[var(--ink)] sm:inline"
            >
              できること
            </a>
            <a
              href="#plugins"
              className="hidden text-[var(--muted)] transition hover:text-[var(--ink)] sm:inline"
            >
              Plugin
            </a>
            <a
              href="#studio"
              className="hidden text-[var(--muted)] transition hover:text-[var(--ink)] sm:inline"
            >
              Studio
            </a>
            <Link
              href={isLoggedIn ? '/dashboard' : '/login'}
              className="rounded-full bg-[var(--ink)] px-4 py-1.5 font-semibold text-[#0c0c0e] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)]"
            >
              {isLoggedIn ? 'ダッシュボード' : 'ログイン'}
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------- ヒーロー ---------- */}
      <HeroSpot className="overflow-hidden">
        <div
          aria-hidden="true"
          className="lp-burst lp-par absolute inset-x-0 top-0 h-[46rem]"
          style={vars({ '--ps': '0.12' })}
        />
        <span
          aria-hidden="true"
          className="lp-halftone lp-par absolute -left-24 top-16 h-80 w-80 text-[var(--pink)]"
          style={vars({ '--ps': '0.3' })}
        />
        <span
          aria-hidden="true"
          className="lp-halftone lp-par absolute -right-24 top-[30rem] h-96 w-96 text-[var(--cyan)]"
          style={vars({ '--ps': '-0.18' })}
        />
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-16 pt-16 text-center sm:px-6 sm:pt-24 lg:px-8">
          <p className="lp-rise" style={vars({ '--lp-d': '0ms' })}>
            <Ribbon color="var(--yellow)">DISCORD COMMUNITY OS</Ribbon>
          </p>

          <div className="relative mx-auto mt-8 w-fit max-w-full">
            <Sparkle className="-left-9 top-0 h-7 w-7 text-[var(--yellow)]" delay="900ms" />
            <Sparkle className="-right-8 -top-5 h-5 w-5 text-[var(--cyan)]" delay="1050ms" />
            <Sparkle className="-right-12 bottom-1 h-9 w-9 text-[var(--pink)]" delay="1200ms" />
            <h1
              aria-label={`${HEADLINE_1}${HEADLINE_2}`}
              className="-skew-x-6 text-[1.9rem] font-black leading-[1.25] tracking-[-0.035em] max-[374px]:text-[1.6rem] sm:text-6xl sm:leading-[1.15] lg:text-[5.25rem] lg:leading-[1.08]"
            >
              <span className="block">
                <Chars text={HEADLINE_1} />
              </span>
              <span className="block">
                <span className="lp-glitch inline-block">
                  <Chars text="Herta" start={HEADLINE_1.length} className="lp-pop-name" />
                </span>
                <Chars text="にまかせて。" start={HEADLINE_1.length + 5} />
              </span>
            </h1>
          </div>

          <p
            className="lp-rise mx-auto mt-7 max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl"
            style={vars({ '--lp-d': '700ms' })}
          >
            {
              '荒らし対策、ロールの付与、誕生日のお祝い、ゲームの募集。毎回手でやっていた作業を、Botと管理画面にまとめました。'
            }
          </p>

          <div
            className="lp-rise mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4"
            style={vars({ '--lp-d': '820ms' })}
          >
            {primaryCta}
            <a
              href="#plugins"
              className="inline-flex items-center gap-0.5 text-base font-bold text-[var(--cyan)] underline decoration-2 underline-offset-4 transition hover:text-white"
            >
              Pluginを見る
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>

          <dl
            className="lp-rise lp-mono mx-auto mt-14 flex max-w-xl items-center justify-center divide-x divide-[var(--line)] text-center"
            style={vars({ '--lp-d': '940ms' })}
          >
            {[
              { label: 'PLUGINS', value: MANIFESTS.length, color: 'var(--pink)' },
              { label: 'COMMANDS', value: COMMANDS.length, color: 'var(--cyan)' },
              { label: 'CATEGORIES', value: CATEGORIES.length, color: 'var(--yellow)' },
            ].map((stat) => (
              <div key={stat.label} className="flex-1 px-4">
                <dd
                  className="inline-block -skew-x-6 text-4xl font-black tracking-tight sm:text-5xl"
                  style={{ color: stat.color }}
                >
                  <CountUp to={stat.value} />
                </dd>
                <dt className="mt-1 text-[10px] tracking-[0.2em] text-[var(--muted)]">
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>

          <div className="lp-rise mx-auto mt-16 max-w-3xl" style={vars({ '--lp-d': '1060ms' })}>
            <div className="relative">
              <span aria-hidden="true" className="lp-reticle" />
              <span
                aria-hidden="true"
                className="lp-sticker absolute -right-2 -top-5 z-10 hidden bg-[var(--cyan)] text-sm sm:block"
                style={vars({ '--rot': '5deg', '--lp-d': '1500ms' })}
              >
                触ってみて！
              </span>
              <ScrollScale>
                <CommandPalette commands={COMMANDS} autoplay={AUTOPLAY_COMMANDS} />
              </ScrollScale>
            </div>
            <p className="mt-4 text-xs text-[var(--muted)]">
              Hertaの実際のコマンドです。検索して、触ってみてください。
            </p>
          </div>
        </div>
      </HeroSpot>

      {/* ---------- 流れる帯 (スクロールに連動して横へ動く装飾) ---------- */}
      <div aria-hidden="true" className="lp-band">
        <p className="lp-band-row" style={vars({ '--dir': '-1' })}>
          {BAND_WORDS.join('  ✦  ')} ✦ {BAND_WORDS.join('  ✦  ')}
        </p>
        <p className="lp-band-row lp-band-row--fill" style={vars({ '--dir': '1' })}>
          {[...BAND_WORDS].reverse().join('  ✦  ')} ✦ {[...BAND_WORDS].reverse().join('  ✦  ')}
        </p>
      </div>

      {/* ---------- ステートメント (スクロールで文字が濃くなる) ---------- */}
      <section className="mx-auto w-full max-w-4xl px-5 py-28 sm:px-6 sm:py-40 lg:px-8">
        <div className="text-[1.65rem] font-bold leading-[1.55] tracking-[-0.02em] sm:text-4xl sm:leading-[1.5] lg:text-5xl lg:leading-[1.45]">
          <ScrollText text="荒らし対策も、ロールの付与も、誕生日のお祝いも。毎日の地味な作業は、Hertaが静かに引き受けます。" />
        </div>
      </section>

      {/* ---------- 機能 ---------- */}
      <section id="features" className="scroll-mt-14 pb-28">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
          <Reveal className="lp-wipe">
            <div aria-hidden="true" className="lp-ticks mb-8" />
            <Ribbon color="var(--pink)">01 / FEATURES</Ribbon>
            <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
              Hertaにできること。
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              運営で手が止まりがちなことを、ひとつずつ引き受けます。
            </p>
          </Reveal>

          <ul className="mt-12 grid gap-4 lg:grid-cols-3">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              const tone = TONE[feature.tone];
              const light = LIGHT_TONES.includes(feature.tone);
              const stats = moduleStats(feature.title);
              const shadow = TILE_SHADOW[feature.tone];
              const number = String(index + 1).padStart(2, '0');
              return (
                <li key={feature.title} className={feature.span === 2 ? 'lg:col-span-2' : ''}>
                  <Reveal delay={(index % 3) * 80} className="lp-pop h-full">
                    <TiltCard
                      className="h-full rounded-3xl"
                      bracket={light ? '#14091f' : 'var(--cyan)'}
                    >
                      <article
                        className={`relative flex h-full min-h-[18rem] flex-col overflow-hidden rounded-3xl p-7 sm:p-8 ${tone.tile} ${
                          shadow ? 'border-[3px] border-white' : 'border-t-[3px]'
                        }`}
                        style={
                          shadow
                            ? { boxShadow: `6px 7px 0 ${shadow}` }
                            : { borderTopColor: stats.accent }
                        }
                      >
                        <span aria-hidden="true" className="lp-sweep" />

                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 ${
                              light ? 'border-[#14091f]/80' : 'border-white/30'
                            }`}
                          >
                            <Icon className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <span
                            className="lp-mono -skew-x-12 px-2.5 py-0.5 text-[10px] font-black tracking-[0.2em] text-[var(--pop-ink)]"
                            style={{ backgroundColor: stats.accent }}
                          >
                            <span className="inline-block skew-x-12">
                              <ScrambleText text={`MODULE ${number}`} />
                            </span>
                          </span>
                        </div>

                        <h3 className="mt-7 text-2xl font-black tracking-[-0.02em]">
                          {feature.title}
                        </h3>
                        <p className={`mt-2 max-w-md text-[15px] leading-7 ${tone.body}`}>
                          {feature.description}
                        </p>
                        {feature.viz ? <Viz kind={feature.viz} light={light} /> : null}

                        <ul className="mt-5 flex flex-wrap gap-1.5">
                          {feature.tags.map((tag) => (
                            <li
                              key={tag}
                              className={`rounded-full px-3 py-1 text-xs font-medium ${tone.tag} ${
                                tag.startsWith('/') ? 'lp-mono' : ''
                              }`}
                            >
                              {tag}
                            </li>
                          ))}
                        </ul>

                        {/* 計器: この機能を支える公式Pluginとコマンドの数 (カタログの実データ) */}
                        <div
                          className={`lp-mono mt-auto flex items-center gap-3 border-t border-dashed pt-4 text-[11px] font-bold tracking-wider ${
                            light ? 'border-black/30' : 'border-white/20'
                          }`}
                        >
                          <span>
                            PLUGINS{' '}
                            <b className="text-sm">{String(stats.plugins).padStart(2, '0')}</b>
                          </span>
                          <span>
                            CMD <b className="text-sm">{String(stats.commands).padStart(2, '0')}</b>
                          </span>
                          <span
                            aria-hidden="true"
                            className="ml-auto flex items-center gap-[3px]"
                            title="このカタログ内での、支えるPluginの多さ"
                          >
                            {Array.from({ length: MAX_MODULE_PLUGINS }).map((_, cell) => (
                              <span
                                key={cell}
                                className="h-3 w-1.5 rounded-[1px]"
                                style={{
                                  backgroundColor:
                                    cell < stats.plugins
                                      ? light
                                        ? '#14091f'
                                        : stats.accent
                                      : light
                                        ? 'rgb(0 0 0 / 0.18)'
                                        : 'rgb(255 255 255 / 0.15)',
                                }}
                              />
                            ))}
                          </span>
                        </div>
                      </article>
                    </TiltCard>
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ---------- Plugin 一覧 (実データ) ---------- */}
      <section id="plugins" className="scroll-mt-14 border-t border-[var(--line)] py-28">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
          <Reveal className="lp-wipe">
            <div aria-hidden="true" className="lp-ticks mb-8" />
            <Ribbon color="var(--cyan)">02 / PLUGINS</Ribbon>
            <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
              {`公式 Plugin、${MANIFESTS.length}種。`}
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              必要なものだけを、サーバーごとに有効にできます。ここに並んでいるのは、実際のカタログです。
            </p>
          </Reveal>
          <div className="mt-12">
            <PluginExplorer plugins={PLUGINS} categories={CATEGORIES} />
          </div>
        </div>
      </section>

      {/* ---------- Studio ---------- */}
      <StudioScrolly>
        <Reveal>
          <Ribbon color="var(--yellow)">03 / STUDIO</Ribbon>
          <h2 className="mt-4 text-4xl font-bold leading-[1.2] tracking-[-0.035em] sm:text-5xl sm:leading-[1.2]">
            設定は、
            <br />
            ブラウザから。
          </h2>
          <p className="mt-5 text-base leading-8 text-[var(--muted)]">
            {
              'Discordでログインすると、自分が管理者のサーバーだけが並びます。普段の設定はフォームで、細かい調整が必要なときはJSONでも。BotのTokenがブラウザに渡ることはありません。'
            }
          </p>
        </Reveal>
      </StudioScrolly>

      {/* ---------- はじめ方 ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-28 sm:px-6 lg:px-8">
        <Reveal className="lp-wipe">
          <Ribbon color="var(--pink)">04 / START</Ribbon>
          <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
            はじめ方は、3ステップ。
          </h2>
        </Reveal>
        <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={index * 120}>
                <p
                  className="lp-mono -skew-x-6 text-7xl font-black leading-none tracking-tighter text-transparent"
                  style={{
                    WebkitTextStroke: `2px ${['var(--yellow)', 'var(--pink)', 'var(--cyan)'][index]}`,
                  }}
                >
                  {String(index + 1).padStart(2, '0')}
                </p>
                <h3 className="mt-5 text-xl font-bold tracking-[-0.01em]">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-[var(--muted)]">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- 最後のCTA ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-6 lg:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border-[3px] border-white bg-[var(--yellow)] px-6 py-16 text-center text-[var(--pop-ink)] shadow-[9px_10px_0_var(--pink)] sm:py-24">
            <span
              aria-hidden="true"
              className="lp-halftone absolute -left-20 -top-20 h-72 w-72 text-[var(--pink)]"
            />
            <span
              aria-hidden="true"
              className="lp-halftone absolute -bottom-24 -right-16 h-80 w-80 text-[var(--purple-deep)]"
            />
            <div className="relative">
              <h2 className="text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
                まずは、自分のサーバーで。
              </h2>
              <p className="mt-4 text-lg font-bold opacity-80">
                ログインするだけで、管理しているサーバーが表示されます。
              </p>
              <div className="mt-8 flex justify-center">{primaryCta}</div>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="lp-mono border-t border-[var(--line)] px-5 py-8 text-center text-[11px] tracking-wider text-[var(--muted)]">
        HERTA — DISCORD COMMUNITY OS
      </footer>
    </main>
  );
}
