import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { getAllPluginManifests } from '@herta/plugin-catalog';
import { auth } from '@/auth';
import { DiscordIcon } from '@/components/discord-icon';
import { CommandTyper } from '@/components/landing/command-typer';
import { HeroChatDemo } from '@/components/landing/hero-chat-demo';
import { Reveal } from '@/components/landing/reveal';
import { StudioPreview } from '@/components/landing/studio-preview';
import { signInWithDiscord } from '@/lib/actions';
import './landing.css';

// セッションによって表示(CTA)が変わるため静的化しない。
export const dynamic = 'force-dynamic';

/** 公式Pluginカタログの件数。手書きの数字だと実態とずれるため、カタログから導く。 */
const PLUGIN_COUNT = getAllPluginManifests().length;

const FEATURES = [
  {
    title: 'モデレーション',
    description: '荒らしやスパム、NGワードを検知して自動で対応。ケースの管理と監査ログも残ります。',
    tags: ['検知ルール', 'ケース管理', '監査ログ', 'チャンネルポリシー'],
  },
  {
    title: '自動化と Plugin',
    description: '必要な Plugin だけをサーバーごとにON。設定の変更は履歴に残り、あとから戻せます。',
    tags: ['Auto Response', '予約・定期投稿', 'ルールエンジン', 'Custom Plugin'],
  },
  {
    title: 'XP と Achievements',
    description: '発言やVCでXPが貯まり、レベルに応じてロールや称号がもらえます。',
    tags: ['/leaderboard', '報酬ロール', 'Achievements', 'Community Points'],
  },
  {
    title: 'アクティビティ分析',
    description: '発言・リアクション・VC・オンライン時間を、好きな期間で集計して見られます。',
    tags: ['DAU / WAU / MAU', 'チャンネル別', '/community-stats', '/activity-export'],
  },
  {
    title: '募集とイベント',
    description: '遊ぶ相手の募集、チーム分け、投票、プレゼント企画までDiscordの中で完結します。',
    tags: ['/lfg', 'チーム分け', 'Poll', '/giveaway'],
  },
  {
    title: 'ゲームと診断',
    description: 'ミニゲームやMBTI診断、VALORANTの戦績確認など、雑談が盛り上がる機能です。',
    tags: ['ミニゲーム', 'MBTI診断', '/valorant', 'Akinator'],
  },
  {
    title: 'Birthday',
    description: 'メンバーが自分で誕生日を登録。お祝いカードのデザインも管理画面で作れます。',
    tags: ['登録ページ', 'Birthday Card', 'Birthday Role'],
  },
  {
    title: 'AI',
    description: '会話、画像生成、コード実行、天気の確認。使うAIプロバイダも管理画面で設定します。',
    tags: ['AI会話', '画像生成', 'コード実行', '天気'],
  },
  {
    title: 'ユーティリティ',
    description: 'リマインダーやAFK、サーバー情報の確認、ロールの管理など日々の細かい作業向け。',
    tags: ['/help', 'Reminder', 'AFK', 'Role Manager'],
  },
] as const;

export default async function HomePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  const primaryCta = isLoggedIn ? (
    <Link
      href="/dashboard"
      className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      ダッシュボードを開く
      <ArrowRight className="lp-nudge h-4 w-4" aria-hidden="true" />
    </Link>
  ) : (
    <form action={signInWithDiscord}>
      <input type="hidden" name="callbackUrl" value="/dashboard" />
      <button
        type="submit"
        className="inline-flex items-center gap-2.5 rounded-md bg-[#5865F2] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <DiscordIcon className="h-5 w-5" />
        Discordでログイン
        <ArrowRight className="lp-nudge h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );

  return (
    <main className="lp-root min-h-screen overflow-x-clip bg-background">
      {/* ---------- ヘッダー ---------- */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-6 lg:px-8">
        <p className="text-lg font-semibold tracking-tight">Herta.</p>
        <nav aria-label="メイン" className="flex items-center gap-5 text-sm">
          <a
            href="#features"
            className="lp-link hidden pb-0.5 text-muted hover:text-foreground sm:inline"
          >
            できること
          </a>
          <a
            href="#studio"
            className="lp-link hidden pb-0.5 text-muted hover:text-foreground sm:inline"
          >
            Studio
          </a>
          <Link
            href={isLoggedIn ? '/dashboard' : '/login'}
            className="rounded-md border border-border px-3 py-1.5 font-medium transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isLoggedIn ? 'ダッシュボード' : 'ログイン'}
          </Link>
        </nav>
      </header>

      {/* ---------- ヒーロー ---------- */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-8 lg:pb-28">
        <div>
          <h1
            className="lp-rise text-[1.75rem] font-semibold leading-[1.35] tracking-tight sm:text-5xl sm:leading-[1.25]"
            style={{ '--lp-d': '0ms' } as CSSProperties}
          >
            サーバーの面倒ごとは、
            <br />
            <span className="relative inline-block">
              Herta
              <svg
                className="lp-underline absolute -bottom-1.5 left-0 h-3 w-full text-primary"
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M2 8 C 40 2, 80 11, 120 6 S 180 4, 198 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  pathLength="1"
                />
              </svg>
            </span>
            にまかせて。
          </h1>

          <p
            className="lp-rise mt-6 max-w-xl text-base leading-8 text-muted"
            style={{ '--lp-d': '120ms' } as CSSProperties}
          >
            {
              '荒らし対策、ロールの付与、誕生日のお祝い、ゲームの募集。Discordサーバーの運営で毎回手でやっている地味な作業を、Botと管理画面（Studio）にまとめました。'
            }
          </p>

          <div
            className="lp-rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-4"
            style={{ '--lp-d': '240ms' } as CSSProperties}
          >
            {primaryCta}
            <a
              href="#features"
              className="lp-link inline-flex items-center gap-1.5 pb-0.5 text-sm font-medium"
            >
              できることを見る
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>

          <p
            className="lp-rise mt-10 flex items-center gap-3 font-mono text-sm text-muted"
            style={{ '--lp-d': '360ms' } as CSSProperties}
          >
            <span className="rounded border border-border bg-surface px-2.5 py-1 text-foreground">
              <CommandTyper text="/help" />
            </span>
            <span className="font-sans">で、使えるコマンドの一覧が見られます</span>
          </p>
        </div>

        <div className="lp-rise" style={{ '--lp-d': '200ms' } as CSSProperties}>
          <HeroChatDemo />
        </div>
      </section>

      {/* ---------- 機能 ---------- */}
      <section id="features" className="scroll-mt-4 border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8">
          <Reveal>
            <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
              <h2 className="text-2xl font-semibold tracking-tight">できること</h2>
              <p className="max-w-2xl text-sm leading-7 text-muted">
                {`公式 Plugin は${PLUGIN_COUNT}種類。サーバーの規模や使い方に合わせて、必要なものだけを有効にできます。`}
              </p>
            </div>
          </Reveal>

          <ol className="mt-10 border-t border-border">
            {FEATURES.map((feature, index) => (
              <li key={feature.title}>
                <Reveal delay={Math.min(index, 3) * 40}>
                  <div className="lp-row grid gap-x-6 gap-y-3 border-b border-border px-1 py-6 md:grid-cols-[3rem_13rem_1fr] md:px-3">
                    <span className="font-mono text-xs text-muted md:pt-1">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="text-base font-semibold">{feature.title}</h3>
                    <div>
                      <p className="text-sm leading-7 text-muted">{feature.description}</p>
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {feature.tags.map((tag) => (
                          <li
                            key={tag}
                            className={`rounded border border-border px-2 py-0.5 text-xs ${
                              tag.startsWith('/') ? 'font-mono text-foreground' : 'text-muted'
                            }`}
                          >
                            {tag}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Studio ---------- */}
      <section id="studio" className="scroll-mt-4 border-t border-border bg-surface/50">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:px-8">
          <Reveal>
            <h2 className="text-2xl font-semibold leading-snug tracking-tight">
              設定は、ブラウザの管理画面から。
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted">
              {
                'Discordでログインすると、自分が管理者のサーバーだけが並びます。普段の設定はフォームで、細かい調整が必要なときはJSONでも編集できます。BotのTokenがブラウザに渡ることはありません。'
              }
            </p>
          </Reveal>
          <Reveal delay={80}>
            <StudioPreview />
          </Reveal>
        </div>
      </section>

      {/* ---------- 最後のCTA ---------- */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight">まずは、自分のサーバーで。</h2>
            <p className="mt-2 text-sm text-muted">
              ログインするだけで、管理しているサーバーが表示されます。
            </p>
          </Reveal>
          <Reveal delay={80}>{primaryCta}</Reveal>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-6 text-center text-xs text-muted">
        Herta. — Discord Community OS
      </footer>
    </main>
  );
}
