import type { CSSProperties } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Bot,
  Cake,
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
import { CommandTyper } from '@/components/landing/command-typer';
import { HeroChatDemo } from '@/components/landing/hero-chat-demo';
import { Reveal } from '@/components/landing/reveal';
import { ScrollFx } from '@/components/landing/scroll-fx';
import { StepsProgress } from '@/components/landing/steps-progress';
import { StudioScrolly } from '@/components/landing/studio-scrolly';
import { signInWithDiscord } from '@/lib/actions';
import './landing.css';

// セッションによって表示(CTA)が変わるため静的化しない。
export const dynamic = 'force-dynamic';

const FONT_URL =
  'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800;900&display=swap';

/** 公式Pluginカタログの件数。手書きの数字だと実態とずれるため、カタログから導く。 */
const PLUGIN_COUNT = getAllPluginManifests().length;

interface Feature {
  title: string;
  description: string;
  tags: readonly string[];
  icon: LucideIcon;
  /** カードの背景色 (landing.css の変数) */
  color: string;
}

const FEATURES: readonly Feature[] = [
  {
    title: 'モデレーション',
    description: '荒らしやスパム、NGワードを検知して自動で対応。ケース管理と監査ログも残ります。',
    tags: ['検知ルール', 'ケース管理', '監査ログ', 'チャンネルポリシー'],
    icon: ShieldCheck,
    color: 'var(--mint-soft)',
  },
  {
    title: '自動化と Plugin',
    description: '必要な Plugin だけをサーバーごとにON。設定の変更は履歴に残り、あとから戻せます。',
    tags: ['Auto Response', '予約・定期投稿', 'ルールエンジン', 'Custom Plugin'],
    icon: Puzzle,
    color: 'var(--purple-soft)',
  },
  {
    title: 'XP と Achievements',
    description: '発言やVCでXPが貯まり、レベルに応じてロールや称号がもらえます。',
    tags: ['/leaderboard', '報酬ロール', 'Achievements', 'Community Points'],
    icon: Trophy,
    color: 'var(--yellow-soft)',
  },
  {
    title: 'アクティビティ分析',
    description: '発言・リアクション・VC・オンライン時間を、好きな期間で集計して見られます。',
    tags: ['DAU / WAU / MAU', 'チャンネル別', '/community-stats', '/activity-export'],
    icon: Activity,
    color: 'var(--blue-soft)',
  },
  {
    title: '募集とイベント',
    description: '遊ぶ相手の募集、チーム分け、投票、プレゼント企画までDiscordの中で完結します。',
    tags: ['/lfg', 'チーム分け', 'Poll', '/giveaway'],
    icon: Users,
    color: 'var(--pink-soft)',
  },
  {
    title: 'ゲームと診断',
    description: 'ミニゲームやMBTI診断、VALORANTの戦績確認など、雑談が盛り上がる機能です。',
    tags: ['ミニゲーム', 'MBTI診断', '/valorant', 'Akinator'],
    icon: Gamepad2,
    color: 'var(--orange-soft)',
  },
  {
    title: 'Birthday',
    description: 'メンバーが自分で誕生日を登録。お祝いカードのデザインも管理画面で作れます。',
    tags: ['登録ページ', 'Birthday Card', 'Birthday Role'],
    icon: Cake,
    color: 'var(--pink-soft)',
  },
  {
    title: 'AI',
    description: '会話、画像生成、コード実行、天気の確認。使うAIプロバイダも管理画面で設定します。',
    tags: ['AI会話', '画像生成', 'コード実行', '天気'],
    icon: Bot,
    color: 'var(--blue-soft)',
  },
  {
    title: 'ユーティリティ',
    description: 'リマインダーやAFK、サーバー情報の確認、ロールの管理など日々の細かい作業向け。',
    tags: ['/help', 'Reminder', 'AFK', 'Role Manager'],
    icon: MessagesSquare,
    color: 'var(--mint-soft)',
  },
];

const STEPS = [
  {
    title: 'Discordでログイン',
    body: '自分が管理者のサーバーだけが並びます。',
    color: 'var(--yellow)',
  },
  { title: '使いたい機能をON', body: 'Pluginをトグルで切り替えるだけ。', color: 'var(--pink)' },
  {
    title: 'あとはおまかせ',
    body: '検知も集計もお祝いも、サーバーの中で自動で動きます。',
    color: 'var(--mint)',
  },
] as const;

/** インラインstyleでCSS変数を渡すための小さなヘルパー */
function vars(values: Record<string, string>): CSSProperties {
  return values as CSSProperties;
}

export default async function HomePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  const primaryCta = isLoggedIn ? (
    <Link
      href="/dashboard"
      className="pop pop-hover inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
    >
      ダッシュボードを開く
      <ArrowRight className="lp-nudge h-5 w-5" aria-hidden="true" />
    </Link>
  ) : (
    <form action={signInWithDiscord}>
      <input type="hidden" name="callbackUrl" value="/dashboard" />
      <button
        type="submit"
        className="pop pop-hover inline-flex items-center gap-2.5 rounded-xl bg-[#5865F2] px-6 py-3.5 text-base font-extrabold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
      >
        <DiscordIcon className="h-5 w-5" />
        Discordでログイン
        <ArrowRight className="lp-nudge h-5 w-5" aria-hidden="true" />
      </button>
    </form>
  );

  return (
    <main className="lp-root min-h-screen overflow-x-clip">
      <ScrollFx />
      {/* 丸ゴシックのWebフォント (読み込めない環境ではシステムフォントにフォールバック) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={FONT_URL} precedence="default" />

      {/* ---------- ヒーロー ---------- */}
      <div className="relative">
        <div aria-hidden="true" className="lp-dots pointer-events-none absolute inset-0" />

        <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-6 lg:px-8">
          <p className="pop-sm inline-block rounded-xl bg-[var(--purple)] px-3.5 py-1 text-xl font-extrabold text-white">
            Herta.
          </p>
          <nav
            aria-label="メイン"
            className="flex items-center gap-2 text-sm font-extrabold sm:gap-4"
          >
            <a
              href="#features"
              className="hidden rounded-lg px-2 py-1 hover:bg-[var(--yellow)] sm:inline"
            >
              できること
            </a>
            <a
              href="#studio"
              className="hidden rounded-lg px-2 py-1 hover:bg-[var(--yellow)] sm:inline"
            >
              Studio
            </a>
            <Link
              href={isLoggedIn ? '/dashboard' : '/login'}
              className="pop-sm pop-hover rounded-xl bg-white px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
            >
              {isLoggedIn ? 'ダッシュボード' : 'ログイン'}
            </Link>
          </nav>
        </header>

        <section className="relative mx-auto grid w-full max-w-6xl items-center gap-14 px-5 pb-24 pt-8 sm:px-6 sm:pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:px-8 lg:pb-32">
          <div>
            <p
              className="lp-pop-in pop-sm inline-block rounded-full bg-[var(--mint)] px-4 py-1 text-xs font-extrabold"
              style={vars({ '--lp-d': '0ms' })}
            >
              Discordサーバー運営のおともBot
            </p>

            <h1
              className="lp-pop-in mt-5 text-[1.9rem] font-extrabold leading-[1.4] tracking-tight sm:text-[2.6rem] sm:leading-[1.3] lg:text-[2.9rem]"
              style={vars({ '--lp-d': '100ms' })}
            >
              サーバーの面倒ごとは、
              <br />
              <span className="lp-mark">Herta</span>にまかせて。
            </h1>

            <p
              className="lp-pop-in mt-6 max-w-xl text-base font-medium leading-8"
              style={vars({ '--lp-d': '220ms' })}
            >
              {
                '荒らし対策、ロールの付与、誕生日のお祝い、ゲームの募集。Discordサーバーの運営で毎回手でやっている地味な作業を、Botと管理画面（Studio）にまとめました。'
              }
            </p>

            <div
              className="lp-pop-in mt-8 flex flex-wrap items-center gap-x-6 gap-y-5"
              style={vars({ '--lp-d': '340ms' })}
            >
              {primaryCta}
              <a
                href="#features"
                className="inline-flex items-center gap-1.5 text-sm font-extrabold underline decoration-[3px] decoration-[var(--pink)] underline-offset-4 hover:decoration-[var(--purple)]"
              >
                できることを見る
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>

            <p
              className="lp-pop-in mt-10 flex flex-wrap items-center gap-3 text-sm font-bold"
              style={vars({ '--lp-d': '460ms' })}
            >
              <span className="pop-sm rounded-lg bg-white px-3 py-1 font-mono text-base font-bold">
                <CommandTyper text="/help" />
              </span>
              <span>で、使えるコマンドの一覧が見られます</span>
            </p>
          </div>

          <div className="relative">
            <span
              aria-hidden="true"
              className="lp-parallax absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[var(--yellow-soft)]"
              style={vars({ '--k': '-0.12' })}
            />
            <span
              aria-hidden="true"
              className="lp-parallax absolute -bottom-10 -left-8 h-24 w-24 rounded-full bg-[var(--pink-soft)]"
              style={vars({ '--k': '-0.04' })}
            />
            <div className="lp-parallax relative" style={vars({ '--k': '-0.06' })}>
              <div className="lp-pop-in" style={vars({ '--lp-d': '250ms' })}>
                <HeroChatDemo />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ---------- 機能 ---------- */}
      <section id="features" className="scroll-mt-4 border-y-[2px] border-[var(--ink)] bg-white">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8">
          <Reveal>
            <p className="pop-sm inline-block rounded-lg bg-[var(--pink)] px-3 py-1 text-xs font-extrabold">
              FEATURES
            </p>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Hertaにできること
            </h2>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-7">
              {`公式 Plugin は${PLUGIN_COUNT}種類。サーバーの規模や使い方に合わせて、必要なものだけを有効にできます。`}
            </p>
          </Reveal>

          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <li key={feature.title}>
                  <Reveal delay={(index % 3) * 70} className="h-full">
                    <article
                      className="pop pop-hover h-full rounded-2xl p-5"
                      style={{ backgroundColor: feature.color }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[var(--ink)] bg-white">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <h3 className="text-lg font-extrabold">{feature.title}</h3>
                      </div>
                      <p className="mt-3 text-sm font-medium leading-7">{feature.description}</p>
                      <ul className="mt-4 flex flex-wrap gap-1.5">
                        {feature.tags.map((tag) => (
                          <li
                            key={tag}
                            className={`rounded-full border-2 border-[var(--ink)] bg-white px-2.5 py-0.5 text-xs font-bold ${
                              tag.startsWith('/') ? 'font-mono' : ''
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
          <p className="inline-block rounded-lg border-[1.5px] border-[var(--ink)] bg-[var(--yellow)] px-3 py-1 text-xs font-extrabold text-[var(--ink)] shadow-[2px_2px_0_var(--ink)]">
            STUDIO
          </p>
          <h2 className="mt-4 text-3xl font-extrabold leading-snug tracking-tight sm:text-4xl">
            設定は、ブラウザの
            <br />
            管理画面から。
          </h2>
          <p className="mt-4 text-sm font-medium leading-7">
            {
              'Discordでログインすると、自分が管理者のサーバーだけが並びます。普段の設定はフォームで、細かい調整が必要なときはJSONでも編集できます。BotのTokenがブラウザに渡ることはありません。'
            }
          </p>
        </Reveal>
      </StudioScrolly>

      {/* ---------- はじめ方 ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8">
        <Reveal>
          <p className="pop-sm inline-block rounded-lg bg-[var(--mint)] px-3 py-1 text-xs font-extrabold">
            HOW TO START
          </p>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
            はじめ方は、3ステップ。
          </h2>
        </Reveal>
        <StepsProgress steps={STEPS} />
      </section>

      {/* ---------- 最後のCTA ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-6 lg:px-8">
        <Reveal>
          <div
            className="pop flex flex-col items-start gap-6 rounded-3xl bg-[var(--yellow)] p-7 sm:p-10 md:flex-row md:items-center md:justify-between"
            style={{ boxShadow: '5px 5px 0 var(--ink)' }}
          >
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
                まずは、自分のサーバーで。
              </h2>
              <p className="mt-2 text-sm font-bold">
                ログインするだけで、管理しているサーバーが表示されます。
              </p>
            </div>
            {primaryCta}
          </div>
        </Reveal>
      </section>

      <footer className="border-t-[2px] border-[var(--ink)] bg-white px-5 py-6 text-center text-xs font-bold">
        Herta. — Discord Community OS
      </footer>
    </main>
  );
}
