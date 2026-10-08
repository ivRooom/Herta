import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bot,
  Cake,
  Gamepad2,
  Gift,
  MessagesSquare,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { auth } from '@/auth';
import { DiscordIcon } from '@/components/discord-icon';
import { signInWithDiscord } from '@/lib/actions';

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

export default async function HomePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(circle at 15% 12%, hsl(var(--primary) / 0.18) 0, transparent 34%), radial-gradient(circle at 85% 60%, hsl(var(--primary) / 0.12) 0, transparent 30%)',
        }}
      />

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
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isLoggedIn ? 'ダッシュボード' : 'ログイン'}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </header>

      <section className="relative mx-auto w-full max-w-6xl px-5 pb-12 pt-8 sm:px-6 sm:pt-14 lg:px-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Herta. — Discord Community Operating System
        </div>
        <h1 className="mt-6 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
          Discordコミュニティの運営を、
          <span className="text-primary">もっとかんたん</span>に、もっと楽しく。
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted sm:text-base">
          Hertaはモデレーション、自動化、コミュニティ分析、ミニゲームまでをひとつにまとめた
          DiscordのBot兼管理ダッシュボードです。日常の運営はわかりやすいUIで、
          細かな調整はJSONでも行えます。
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                className="group inline-flex items-center gap-3 rounded-2xl bg-[#5865F2] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <DiscordIcon className="h-5 w-5" />
                Discordでログイン
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </form>
          )}
          <a
            href="#features"
            className="inline-flex items-center rounded-2xl border border-border bg-surface px-5 py-3 text-sm font-medium transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            できることを見る
          </a>
        </div>
      </section>

      <section
        id="features"
        className="relative mx-auto w-full max-w-6xl scroll-mt-6 px-5 pb-16 sm:px-6 lg:px-8"
      >
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Hertaにできること</h2>
        <p className="mt-2 text-sm text-muted">
          サーバーの規模や用途に合わせて、必要な機能だけをGuildごとに有効化できます。
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_GROUPS.map((group) => {
            const Icon = group.icon;
            return (
              <article
                key={group.title}
                className="rounded-2xl border border-border bg-surface/80 p-5 backdrop-blur-sm"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
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
              </article>
            );
          })}
        </div>
      </section>

      <section className="relative mx-auto w-full max-w-6xl px-5 pb-16 sm:px-6 lg:px-8">
        <div className="grid gap-4 rounded-3xl border border-border bg-surface/90 p-6 shadow-card sm:p-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Herta Studioで、すべてを一画面から
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Bot・Discord・DB・Redis・Workerの稼働状況の確認から、Plugin設定、ロール管理、
              監査ログまで。Discord
              OAuthでログインすると、管理権限を持つサーバーだけが表示されます。 Bot
              Tokenがブラウザへ渡ることはありません。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link
              href={isLoggedIn ? '/dashboard' : '/login'}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Gift className="h-4 w-4" aria-hidden="true" />
              {isLoggedIn ? 'ダッシュボードへ' : 'はじめる'}
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative border-t border-border px-5 py-6 text-center text-xs text-muted">
        Herta. — Discord Community OS
      </footer>
    </main>
  );
}
