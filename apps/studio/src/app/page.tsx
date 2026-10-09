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

type Tone = 'dark' | 'accent' | 'light';

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
    tone: 'dark',
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
    tone: 'dark',
    span: 1,
  },
  {
    title: 'ゲームと診断',
    description: 'ミニゲームやMBTI診断、VALORANTの戦績確認など、雑談が盛り上がる機能です。',
    tags: ['ミニゲーム', 'MBTI診断', '/valorant', 'Akinator'],
    icon: Gamepad2,
    tone: 'light',
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
    tone: 'accent',
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
};

/** 面の中の小さな図。表示されたときに1回だけ動き、JS無効では完成形のまま表示される。 */
function VizFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 rounded-xl border border-white/[0.08] bg-black/25 p-4" aria-hidden="true">
      <p className="lp-mono mb-3 text-[10px] tracking-widest text-white/35">IMAGE</p>
      {children}
    </div>
  );
}

function Viz({ kind }: { kind: NonNullable<Feature['viz']> }) {
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
      <VizFrame>
        <div className="flex items-end justify-between">
          <p className="text-4xl font-semibold tracking-tight">
            Lv.<span className="text-[var(--purple)]">12</span>
          </p>
          <p className="lp-mono text-[11px] text-white/45">72%</p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="viz-fill h-full w-[72%] origin-left rounded-full bg-[var(--purple)]" />
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

/**
 * 読み込み表示の要否を、画面が描画される前に決めるための小さなスクリプト。
 * - 同じタブで2回目以降 → lp-seen (読み込み表示を出さない)
 * - 初回 → lp-loading (表示中はヒーローの出現を待たせる)。念のため6秒で必ず解除する。
 * JSが動かない環境では何も付かず、読み込み表示は <noscript> のスタイルで隠れる。
 */
const LOADER_BOOT_SCRIPT = `(function(){try{var r=document.currentScript.parentElement;if(sessionStorage.getItem('lp-seen')){r.classList.add('lp-seen');return;}r.classList.add('lp-loading');setTimeout(function(){r.classList.remove('lp-loading')},6000)}catch(e){}})()`;

const HEADLINE_1 = 'サーバーの面倒ごとは、';
const HEADLINE_2 = 'Hertaにまかせて。';

export default async function HomePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  const primaryCta = isLoggedIn ? (
    <Link
      href="/dashboard"
      className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-7 py-3.5 text-base font-semibold text-[#0c0c0e] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
    >
      ダッシュボードを開く
      <ArrowRight className="lp-nudge h-4 w-4" aria-hidden="true" />
    </Link>
  ) : (
    <form action={signInWithDiscord}>
      <input type="hidden" name="callbackUrl" value="/dashboard" />
      <button
        type="submit"
        className="inline-flex items-center gap-2.5 rounded-full bg-[#5865F2] px-7 py-3.5 text-base font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
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
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-16 pt-16 text-center sm:px-6 sm:pt-24 lg:px-8">
          <p
            className="lp-rise lp-mono mx-auto inline-flex items-center gap-2.5 rounded-full border border-[var(--line)] bg-white/[0.03] px-4 py-1.5 text-[11px] tracking-wider text-[var(--muted)]"
            style={vars({ '--lp-d': '0ms' })}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--signal)]" />
            DISCORD COMMUNITY OS
          </p>

          <h1
            aria-label={`${HEADLINE_1}${HEADLINE_2}`}
            className="mt-7 text-[1.9rem] font-bold leading-[1.25] tracking-[-0.035em] max-[374px]:text-[1.6rem] sm:text-6xl sm:leading-[1.15] lg:text-[5.25rem] lg:leading-[1.08]"
          >
            <span className="block">
              <Chars text={HEADLINE_1} />
            </span>
            <span className="block">
              <Chars text="Herta" start={HEADLINE_1.length} className="text-[var(--purple)]" />
              <Chars text="にまかせて。" start={HEADLINE_1.length + 5} />
            </span>
          </h1>

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
              className="inline-flex items-center gap-0.5 text-base font-medium text-[var(--purple)] transition hover:text-white"
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
              { label: 'PLUGINS', value: MANIFESTS.length },
              { label: 'COMMANDS', value: COMMANDS.length },
              { label: 'CATEGORIES', value: CATEGORIES.length },
            ].map((stat) => (
              <div key={stat.label} className="flex-1 px-4">
                <dd className="text-3xl font-medium tracking-tight sm:text-4xl">
                  <CountUp to={stat.value} />
                </dd>
                <dt className="mt-1 text-[10px] tracking-[0.2em] text-[var(--muted)]">
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>

          <div className="lp-rise mx-auto mt-16 max-w-3xl" style={vars({ '--lp-d': '1060ms' })}>
            <ScrollScale>
              <CommandPalette commands={COMMANDS} autoplay={AUTOPLAY_COMMANDS} />
            </ScrollScale>
            <p className="mt-4 text-xs text-[var(--muted)]">
              Hertaの実際のコマンドです。検索して、触ってみてください。
            </p>
          </div>
        </div>
      </HeroSpot>

      {/* ---------- ステートメント (スクロールで文字が濃くなる) ---------- */}
      <section className="mx-auto w-full max-w-4xl px-5 py-28 sm:px-6 sm:py-40 lg:px-8">
        <div className="text-[1.65rem] font-bold leading-[1.55] tracking-[-0.02em] sm:text-4xl sm:leading-[1.5] lg:text-5xl lg:leading-[1.45]">
          <ScrollText text="荒らし対策も、ロールの付与も、誕生日のお祝いも。毎日の地味な作業は、Hertaが静かに引き受けます。" />
        </div>
      </section>

      {/* ---------- 機能 ---------- */}
      <section id="features" className="scroll-mt-14 pb-28">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
          <Reveal>
            <p className="lp-mono text-xs tracking-[0.2em] text-[var(--purple)]">01 / FEATURES</p>
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
              return (
                <li key={feature.title} className={feature.span === 2 ? 'lg:col-span-2' : ''}>
                  <Reveal delay={(index % 3) * 80} className="h-full">
                    <TiltCard className="h-full rounded-3xl">
                      <article
                        className={`flex h-full min-h-[17rem] flex-col rounded-3xl p-7 sm:p-8 ${tone.tile}`}
                      >
                        <Icon className="h-6 w-6 opacity-90" aria-hidden="true" />
                        <h3 className="mt-8 text-2xl font-bold tracking-[-0.02em]">
                          {feature.title}
                        </h3>
                        <p className={`mt-2 max-w-md text-[15px] leading-7 ${tone.body}`}>
                          {feature.description}
                        </p>
                        {feature.viz ? <Viz kind={feature.viz} /> : null}
                        <ul className="mt-auto flex flex-wrap gap-1.5 pt-6">
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
          <Reveal>
            <p className="lp-mono text-xs tracking-[0.2em] text-[var(--purple)]">02 / PLUGINS</p>
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
          <p className="lp-mono text-xs tracking-[0.2em] text-[var(--purple)]">03 / STUDIO</p>
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
        <Reveal>
          <p className="lp-mono text-xs tracking-[0.2em] text-[var(--purple)]">04 / START</p>
          <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
            はじめ方は、3ステップ。
          </h2>
        </Reveal>
        <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={index * 120}>
                <p
                  className="lp-mono text-7xl font-medium leading-none tracking-tighter text-transparent"
                  style={{ WebkitTextStroke: '1px var(--purple)' }}
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
          <div className="relative overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] px-6 py-16 text-center sm:py-24">
            <div aria-hidden="true" className="lp-grid" />
            <div className="relative">
              <h2 className="text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
                まずは、自分のサーバーで。
              </h2>
              <p className="mt-4 text-lg text-[var(--muted)]">
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
