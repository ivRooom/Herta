import type { CSSProperties } from 'react';
import Link from 'next/link';
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
import { HeroChatDemo } from '@/components/landing/hero-chat-demo';
import { PageLoader } from '@/components/landing/page-loader';
import { Reveal } from '@/components/landing/reveal';
import { ScrollScale } from '@/components/landing/scroll-scale';
import { ScrollText } from '@/components/landing/scroll-text';
import { StudioScrolly } from '@/components/landing/studio-scrolly';
import { signInWithDiscord } from '@/lib/actions';
import './landing.css';

// セッションによって表示(CTA)が変わるため静的化しない。
export const dynamic = 'force-dynamic';

/** 公式Pluginカタログの件数。手書きの数字だと実態とずれるため、カタログから導く。 */
const PLUGIN_COUNT = getAllPluginManifests().length;

type Tone = 'light' | 'dark' | 'purple';

interface Feature {
  title: string;
  description: string;
  tags: readonly string[];
  icon: LucideIcon;
  tone: Tone;
  /** lg以上での占有カラム数 (全体は3カラム) */
  span: 1 | 2;
}

const FEATURES: readonly Feature[] = [
  {
    title: 'モデレーション',
    description: '荒らしやスパム、NGワードを検知して自動で対応。ケース管理と監査ログも残ります。',
    tags: ['検知ルール', 'ケース管理', '監査ログ', 'チャンネルポリシー'],
    icon: ShieldCheck,
    tone: 'dark',
    span: 2,
  },
  {
    title: '自動化と Plugin',
    description: '必要な Plugin だけをサーバーごとにON。設定の変更は履歴に残り、あとから戻せます。',
    tags: ['Auto Response', '予約・定期投稿', 'ルールエンジン', 'Custom Plugin'],
    icon: Puzzle,
    tone: 'purple',
    span: 1,
  },
  {
    title: 'XP と Achievements',
    description: '発言やVCでXPが貯まり、レベルに応じてロールや称号がもらえます。',
    tags: ['/leaderboard', '報酬ロール', 'Achievements', 'Community Points'],
    icon: Trophy,
    tone: 'light',
    span: 1,
  },
  {
    title: 'アクティビティ分析',
    description: '発言・リアクション・VC・オンライン時間を、好きな期間で集計して見られます。',
    tags: ['DAU / WAU / MAU', 'チャンネル別', '/community-stats', '/activity-export'],
    icon: Activity,
    tone: 'light',
    span: 2,
  },
  {
    title: '募集とイベント',
    description: '遊ぶ相手の募集、チーム分け、投票、プレゼント企画までDiscordの中で完結します。',
    tags: ['/lfg', 'チーム分け', 'Poll', '/giveaway'],
    icon: Users,
    tone: 'light',
    span: 1,
  },
  {
    title: 'ゲームと診断',
    description: 'ミニゲームやMBTI診断、VALORANTの戦績確認など、雑談が盛り上がる機能です。',
    tags: ['ミニゲーム', 'MBTI診断', '/valorant', 'Akinator'],
    icon: Gamepad2,
    tone: 'purple',
    span: 1,
  },
  {
    title: 'Birthday',
    description: 'メンバーが自分で誕生日を登録。お祝いカードのデザインも管理画面で作れます。',
    tags: ['登録ページ', 'Birthday Card', 'Birthday Role'],
    icon: Cake,
    tone: 'light',
    span: 1,
  },
  {
    title: 'AI',
    description: '会話、画像生成、コード実行、天気の確認。使うAIプロバイダも管理画面で設定します。',
    tags: ['AI会話', '画像生成', 'コード実行', '天気'],
    icon: Bot,
    tone: 'dark',
    span: 1,
  },
  {
    title: 'ユーティリティ',
    description: 'リマインダーやAFK、サーバー情報の確認、ロールの管理など日々の細かい作業向け。',
    tags: ['/help', 'Reminder', 'AFK', 'Role Manager'],
    icon: MessagesSquare,
    tone: 'light',
    span: 2,
  },
];

const TONE_CLASS: Record<Tone, { tile: string; body: string; tag: string }> = {
  light: {
    tile: 'bg-[var(--tint)]',
    body: 'text-[var(--muted)]',
    tag: 'bg-white text-[var(--muted)]',
  },
  dark: {
    tile: 'bg-[var(--ink)] text-white',
    body: 'text-white/70',
    tag: 'bg-white/10 text-white/80',
  },
  purple: {
    tile: 'bg-[var(--purple)] text-white',
    body: 'text-white/80',
    tag: 'bg-white/15 text-white',
  },
};

const STEPS = [
  { title: 'Discordでログイン', body: '自分が管理者のサーバーだけが一覧に並びます。' },
  {
    title: '使いたい機能をON',
    body: 'Pluginをトグルで切り替えるだけ。設定はあとから変えられます。',
  },
  { title: 'あとはおまかせ', body: '検知も集計もお祝いも、サーバーの中で自動で動きます。' },
] as const;

/** インラインstyleでCSS変数を渡すための小さなヘルパー */
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

export default async function HomePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  const loginLabel = isLoggedIn ? 'ダッシュボードを開く' : 'Discordでログイン';

  const primaryCta = isLoggedIn ? (
    <Link
      href="/dashboard"
      className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-7 py-3.5 text-base font-semibold text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2"
    >
      {loginLabel}
      <ArrowRight className="lp-nudge h-4 w-4" aria-hidden="true" />
    </Link>
  ) : (
    <form action={signInWithDiscord}>
      <input type="hidden" name="callbackUrl" value="/dashboard" />
      <button
        type="submit"
        className="inline-flex items-center gap-2.5 rounded-full bg-[#5865F2] px-7 py-3.5 text-base font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2"
      >
        <DiscordIcon className="h-5 w-5" />
        {loginLabel}
        <ArrowRight className="lp-nudge h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );

  return (
    <main className="lp-root min-h-screen overflow-x-clip" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: LOADER_BOOT_SCRIPT }} />
      <noscript>
        <style>{'.lp-loader{display:none!important}'}</style>
      </noscript>
      <PageLoader />

      {/* ---------- ナビゲーション ---------- */}
      <header className="sticky top-0 z-40 border-b border-black/5 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6 lg:px-8">
          <p className="text-lg font-semibold tracking-tight">Herta</p>
          <nav aria-label="メイン" className="flex items-center gap-6 text-[13px]">
            <a
              href="#features"
              className="hidden text-[var(--muted)] transition hover:text-[var(--ink)] sm:inline"
            >
              できること
            </a>
            <a
              href="#studio"
              className="hidden text-[var(--muted)] transition hover:text-[var(--ink)] sm:inline"
            >
              Studio
            </a>
            <Link
              href={isLoggedIn ? '/dashboard' : '/login'}
              className="rounded-full bg-[var(--ink)] px-4 py-1.5 font-semibold text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2"
            >
              {isLoggedIn ? 'ダッシュボード' : 'ログイン'}
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------- ヒーロー ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-12 pt-16 text-center sm:px-6 sm:pt-24 lg:px-8">
        <p
          className="lp-rise text-sm font-semibold text-[var(--purple)] sm:text-base"
          style={vars({ '--lp-d': '0ms' })}
        >
          Discord Community OS
        </p>
        <h1
          className="lp-rise mt-4 text-[1.9rem] max-[374px]:text-[1.6rem] font-bold leading-[1.25] tracking-[-0.03em] sm:text-6xl sm:leading-[1.15] lg:text-7xl lg:leading-[1.12]"
          style={vars({ '--lp-d': '100ms' })}
        >
          サーバーの面倒ごとは、
          <br />
          <span className="text-[var(--purple)]">Herta</span>にまかせて。
        </h1>
        <p
          className="lp-rise mx-auto mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl"
          style={vars({ '--lp-d': '220ms' })}
        >
          {
            '荒らし対策、ロールの付与、誕生日のお祝い、ゲームの募集。毎回手でやっていた作業を、Botと管理画面にまとめました。'
          }
        </p>
        <div
          className="lp-rise mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4"
          style={vars({ '--lp-d': '340ms' })}
        >
          {primaryCta}
          <a
            href="#features"
            className="inline-flex items-center gap-0.5 text-base font-medium text-[var(--purple)] hover:underline"
          >
            できることを見る
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>

        <div
          className="lp-rise mx-auto mt-16 max-w-3xl text-left"
          style={vars({ '--lp-d': '460ms' })}
        >
          <ScrollScale>
            <HeroChatDemo />
          </ScrollScale>
        </div>
      </section>

      {/* ---------- ステートメント (スクロールで文字が濃くなる) ---------- */}
      <section className="mx-auto w-full max-w-4xl px-5 py-28 sm:px-6 sm:py-40 lg:px-8">
        <div className="text-[1.65rem] font-bold leading-[1.55] tracking-[-0.02em] sm:text-4xl sm:leading-[1.5] lg:text-5xl lg:leading-[1.45]">
          <ScrollText text="荒らし対策も、ロールの付与も、誕生日のお祝いも。毎日の地味な作業は、Hertaが静かに引き受けます。" />
        </div>
      </section>

      {/* ---------- 機能 ---------- */}
      <section id="features" className="scroll-mt-14 bg-white pb-28">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-[-0.03em] sm:text-5xl">
              Hertaにできること。
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              {`公式 Plugin は${PLUGIN_COUNT}種類。必要なものだけを、サーバーごとに有効にできます。`}
            </p>
          </Reveal>

          <ul className="mt-12 grid gap-4 lg:grid-cols-3">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              const tone = TONE_CLASS[feature.tone];
              return (
                <li key={feature.title} className={feature.span === 2 ? 'lg:col-span-2' : ''}>
                  <Reveal delay={(index % 3) * 80} className="h-full">
                    <article
                      className={`lp-tile flex h-full min-h-[17rem] flex-col rounded-[28px] p-7 sm:p-8 ${tone.tile}`}
                    >
                      <Icon className="h-7 w-7" aria-hidden="true" />
                      <h3 className="mt-auto pt-10 text-2xl font-bold tracking-[-0.02em]">
                        {feature.title}
                      </h3>
                      <p className={`mt-2 max-w-md text-[15px] leading-7 ${tone.body}`}>
                        {feature.description}
                      </p>
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
                    </article>
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ---------- Studio ---------- */}
      <StudioScrolly>
        <Reveal>
          <p className="text-base font-semibold text-[#a99bff]">Studio</p>
          <h2 className="mt-3 text-4xl font-bold leading-[1.2] tracking-[-0.03em] sm:text-5xl sm:leading-[1.2]">
            設定は、
            <br />
            ブラウザから。
          </h2>
          <p className="mt-5 text-base leading-8 text-[#a1a1a6]">
            {
              'Discordでログインすると、自分が管理者のサーバーだけが並びます。普段の設定はフォームで、細かい調整が必要なときはJSONでも。BotのTokenがブラウザに渡ることはありません。'
            }
          </p>
        </Reveal>
      </StudioScrolly>

      {/* ---------- はじめ方 ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-28 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-[-0.03em] sm:text-5xl">
            はじめ方は、3ステップ。
          </h2>
        </Reveal>
        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={index * 120}>
                <p className="text-6xl font-light tracking-tight text-[var(--purple)]">
                  {index + 1}
                </p>
                <h3 className="mt-4 text-xl font-bold tracking-[-0.01em]">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-[var(--muted)]">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- 最後のCTA ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-6 lg:px-8">
        <Reveal>
          <div className="rounded-[36px] bg-[var(--tint)] px-6 py-16 text-center sm:py-24">
            <h2 className="text-3xl font-bold tracking-[-0.03em] sm:text-5xl">
              まずは、自分のサーバーで。
            </h2>
            <p className="mt-4 text-lg text-[var(--muted)]">
              ログインするだけで、管理しているサーバーが表示されます。
            </p>
            <div className="mt-8 flex justify-center">{primaryCta}</div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-black/5 px-5 py-8 text-center text-xs text-[var(--muted)]">
        Herta — Discord Community OS
      </footer>
    </main>
  );
}
