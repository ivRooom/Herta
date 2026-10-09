import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bot,
  Cake,
  Gamepad2,
  MessagesSquare,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { getAllPluginManifests } from '@herta/plugin-catalog';
import { auth } from '@/auth';
import { DiscordIcon } from '@/components/discord-icon';
import { CountUp } from '@/components/landing/count-up';
import { Marquee } from '@/components/landing/marquee';
import { HeroChatDemo } from '@/components/landing/hero-chat-demo';
import { Reveal } from '@/components/landing/reveal';
import { SpotlightCard } from '@/components/landing/spotlight-card';
import { StudioPreview } from '@/components/landing/studio-preview';
import { signInWithDiscord } from '@/lib/actions';
import './landing.css';

// セッションによって表示(CTA)が変わるため静的化しない。
export const dynamic = 'force-dynamic';

const FEATURE_GROUPS = [
  {
    icon: ShieldCheck,
    title: 'モデレーション',
    description: 'NGワード・スパム検知、警告・ケース管理、監査ログで安全なサーバー運営を支えます。',
    items: [
      '検知ルールと自動対応',
      'ケース・ブラックリスト管理',
      '監査ログビューア',
      'チャンネルポリシー',
    ],
  },
  {
    icon: Puzzle,
    title: 'Plugin / 自動化',
    description:
      'Guildごとに公式Pluginを有効化し、JSON Schemaに沿った設定をバージョン履歴付きで管理。',
    items: [
      'Auto Response(自動応答)',
      'Message Studio(予約・定期投稿)',
      'Rule Engine',
      'Custom Plugin',
    ],
  },
  {
    icon: Trophy,
    title: 'コミュニティ活性化',
    description: 'XP・レベル・Achievementsでメンバーの参加を可視化し、サーバーを盛り上げます。',
    items: ['XP / レベル / 報酬ロール', 'Achievements・称号', 'Community Points', 'リーダーボード'],
  },
  {
    icon: Activity,
    title: 'アクティビティ分析',
    description: '発言・リアクション・VC・オンライン時間を集計し、DAU/WAU/MAUまで一目で把握。',
    items: [
      '期間指定のコミュニティ統計',
      'チャンネル別の内訳',
      'CSV / JSONエクスポート',
      'Activity Log',
    ],
  },
  {
    icon: Users,
    title: 'みんなで遊ぶ・集まる',
    description: 'ゲーム仲間の募集やチーム分け、イベント、投票までDiscord上で完結。',
    items: [
      'LFG(メンバー募集)',
      'Team Split(チーム分け)',
      'Poll・Event RSVP',
      'Giveaway・Suggestion',
    ],
  },
  {
    icon: Gamepad2,
    title: 'ミニゲーム & 診断',
    description: 'ブラックジャックやじゃんけん、アミダなどの遊びと、MBTI診断・VALORANT戦績確認。',
    items: ['ミニゲーム各種', 'MBTI診断カード', 'VALORANT戦績(/valorant)', 'Akinator'],
  },
  {
    icon: Cake,
    title: 'Birthday',
    description: '誕生日の自己登録とお祝い。Birthday Cardを自由にデザインしてお祝いできます。',
    items: ['メンバー自己登録ページ', 'Birthday Cardエディタ', 'Birthday Role', 'サーバー記念日'],
  },
  {
    icon: Bot,
    title: 'AI アシスタント',
    description: '会話・画像生成・コード実行・天気情報などをBotへ。プロバイダ設定もStudioから。',
    items: ['AI会話', '画像生成 / コード実行', '天気(気象庁)連携', 'Botプロフィール設定'],
  },
  {
    icon: MessagesSquare,
    title: 'ユーティリティ',
    description: 'リマインダー、AFK、サーバー情報、各種変換ツールなど日常で使えるコマンド群。',
    items: [
      '/help コマンド一覧',
      'Reminder・AFK',
      'サーバー / ユーザー情報',
      'Role Manager・Self Role',
    ],
  },
] as const;

/** 公式Pluginカタログの件数。手書きの数字だと実態とずれるため、カタログから導く。 */
const PLUGIN_COUNT = getAllPluginManifests().length;

const FEATURE_COUNT = FEATURE_GROUPS.reduce((total, group) => total + group.items.length, 0);

const STEPS = [
  {
    title: 'Discordでログイン',
    description: '管理権限を持つサーバーだけが一覧に表示されます。',
  },
  {
    title: '必要な機能をON',
    description: 'Pluginをトグルで有効化。細かい設定はフォームかJSONで。',
  },
  {
    title: 'あとはHertaにおまかせ',
    description: '検知・集計・お祝い・募集まで、サーバーの中で自動で動きます。',
  },
] as const;

/** マーキー用に機能名を平坦化する */
const MARQUEE_ITEMS = FEATURE_GROUPS.flatMap((group) => group.items);

export default async function HomePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  const primaryCta = isLoggedIn ? (
    <Link
      href="/dashboard"
      className="lp-btn-shine group inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-[0_12px_30px_-10px_hsl(var(--primary)/0.7)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      ダッシュボードを開く
      <ArrowRight
        className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  ) : (
    <form action={signInWithDiscord}>
      <input type="hidden" name="callbackUrl" value="/dashboard" />
      <button
        type="submit"
        className="lp-btn-shine group inline-flex items-center gap-3 rounded-2xl bg-[#5865F2] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_12px_30px_-10px_rgb(88_101_242/0.8)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <DiscordIcon className="h-5 w-5" />
        Discordでログイン
        <ArrowRight
          className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </button>
    </form>
  );

  return (
    <main className="lp-root relative min-h-screen overflow-x-clip bg-background">
      {/* ---------- 背景 ---------- */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[60rem]">
        <div className="lp-aurora lp-aurora--1 -left-24 top-0 h-96 w-96" />
        <div className="lp-aurora lp-aurora--2 right-0 top-24 h-[28rem] w-[28rem]" />
        <div className="lp-aurora lp-aurora--3 left-1/3 top-[30rem] h-80 w-80" />
        <div className="lp-grid absolute inset-0" />
      </div>

      {/* ---------- ヘッダー ---------- */}
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary text-base font-bold text-primary-foreground shadow-card">
            H
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Herta Studio</p>
            <p className="text-xs text-muted">Discord Community OS</p>
          </div>
        </div>
        <Link
          href={isLoggedIn ? '/dashboard' : '/login'}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface/80 px-3.5 py-2 text-sm font-medium backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isLoggedIn ? 'ダッシュボード' : 'ログイン'}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </header>

      {/* ---------- ヒーロー ---------- */}
      <section className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-8 sm:px-6 sm:pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:px-8 lg:pb-24">
        <div>
          <div
            className="lp-pop inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
            style={{ animationDelay: '0ms' }}
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="lp-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Discord Community Operating System
          </div>

          <h1
            className="lp-pop mt-6 text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl"
            style={{ animationDelay: '120ms' }}
          >
            サーバー運営を、
            <br />
            <span className="lp-shimmer">もっとかんたんに。</span>
            <br />
            もっと楽しく。
          </h1>

          <p
            className="lp-pop mt-5 max-w-xl text-sm leading-7 text-muted sm:text-base"
            style={{ animationDelay: '240ms' }}
          >
            Hertaはモデレーション、自動化、コミュニティ分析、ミニゲームまでをひとつにまとめた
            DiscordのBot兼管理ダッシュボード。日常の運営はわかりやすいUIで、
            細かな調整はJSONでも行えます。
          </p>

          <div
            className="lp-pop mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: '360ms' }}
          >
            {primaryCta}
            <a
              href="#features"
              className="inline-flex items-center rounded-2xl border border-border bg-surface/80 px-6 py-3.5 text-sm font-medium backdrop-blur transition hover:-translate-y-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              できることを見る
            </a>
          </div>

          <dl
            className="lp-pop mt-10 grid max-w-md grid-cols-3 gap-3"
            style={{ animationDelay: '480ms' }}
          >
            <div className="rounded-2xl border border-border bg-surface/70 p-3.5 backdrop-blur">
              <dt className="text-[11px] text-muted">機能カテゴリ</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight text-primary">
                <CountUp to={FEATURE_GROUPS.length} />
              </dd>
            </div>
            <div className="rounded-2xl border border-border bg-surface/70 p-3.5 backdrop-blur">
              <dt className="text-[11px] text-muted">主な機能</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight text-primary">
                <CountUp to={FEATURE_COUNT} />
              </dd>
            </div>
            <div className="rounded-2xl border border-border bg-surface/70 p-3.5 backdrop-blur">
              <dt className="text-[11px] text-muted">公式Plugin</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight text-primary">
                <CountUp to={PLUGIN_COUNT} />
              </dd>
            </div>
          </dl>
        </div>

        <div className="lp-pop" style={{ animationDelay: '300ms' }}>
          <HeroChatDemo />
        </div>
      </section>

      {/* ---------- マーキー ---------- */}
      <section aria-label="機能一覧" className="relative border-y border-border bg-surface/40 py-4">
        <Marquee>
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              aria-hidden={copy === 1}
              className="flex shrink-0 items-center gap-3 pr-3"
            >
              {MARQUEE_ITEMS.map((item) => (
                <li
                  key={`${copy}-${item}`}
                  className="flex items-center gap-3 whitespace-nowrap rounded-full border border-border bg-background/70 px-4 py-1.5 text-xs font-medium"
                >
                  <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          ))}
        </Marquee>
      </section>

      {/* ---------- 機能 ---------- */}
      <section
        id="features"
        className="relative mx-auto w-full max-w-6xl scroll-mt-6 px-5 py-20 sm:px-6 lg:px-8"
      >
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Features</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">
            Hertaにできること
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
            サーバーの規模や用途に合わせて、必要な機能だけをGuildごとに有効化できます。
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_GROUPS.map((group, index) => {
            const Icon = group.icon;
            return (
              <Reveal key={group.title} delay={(index % 3) * 90}>
                <SpotlightCard className="h-full">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{group.title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-muted">{group.description}</p>
                  <ul className="mt-3 space-y-1.5 text-xs">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ---------- Studioプレビュー ---------- */}
      <section className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Herta Studio
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">
            すべてを、ひとつの画面から。
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted">
            Bot・Discord・DB・Redis・Workerの稼働状況から、Plugin設定、ロール管理、
            監査ログまで。Discord OAuthでログインすると、管理権限を持つサーバーだけが表示され、 Bot
            Tokenがブラウザへ渡ることはありません。
          </p>
        </Reveal>
        <Reveal delay={120}>
          <StudioPreview />
        </Reveal>
      </section>

      {/* ---------- はじめ方 ---------- */}
      <section className="relative mx-auto w-full max-w-6xl px-5 pb-20 sm:px-6 lg:px-8">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Get started
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">
            はじめ方は、3ステップ。
          </h2>
        </Reveal>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={index * 120} className="h-full">
                <SpotlightCard className="h-full">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-muted">{step.description}</p>
                </SpotlightCard>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- 最後のCTA ---------- */}
      <section className="relative mx-auto w-full max-w-6xl px-5 pb-24 sm:px-6 lg:px-8">
        <Reveal>
          <div className="lp-glow-border">
            <div className="relative overflow-hidden rounded-[1.65rem] bg-surface px-6 py-12 text-center sm:px-12 sm:py-16">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-60"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.25), transparent 60%)',
                }}
              />
              <h2 className="relative text-2xl font-semibold tracking-tight sm:text-4xl">
                あなたのサーバーを、
                <span className="lp-shimmer">Hertaと一緒に。</span>
              </h2>
              <p className="relative mx-auto mt-4 max-w-xl text-sm leading-7 text-muted">
                ログインして、管理しているサーバーでHertaの機能を試してみましょう。
              </p>
              <div className="relative mt-8 flex justify-center">{primaryCta}</div>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="relative border-t border-border px-5 py-6 text-center text-xs text-muted">
        Herta. — Discord Community OS
      </footer>
    </main>
  );
}
