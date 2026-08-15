import { redirect } from 'next/navigation';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  Puzzle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { auth } from '@/auth';
import { DiscordIcon } from '@/components/discord-icon';
import { signInWithDiscord } from '@/lib/actions';
import { normalizeDashboardCallbackUrl } from '@/lib/auth-navigation';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Moderation Control',
    description: '検知・警告・削除・ケース・自動対応をひとつの運用フローへ。',
  },
  {
    icon: Puzzle,
    title: 'Plugin Studio',
    description: '公式PluginとCustom PluginをGuildごとに構成・管理。',
  },
  {
    icon: Activity,
    title: 'Live Operations',
    description: 'Bot・Discord・DB・Redis・Workerの状態を一画面で確認。',
  },
] as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const { callbackUrl, error } = await searchParams;
  const safeCallbackUrl = normalizeDashboardCallbackUrl(callbackUrl);

  if (session?.user) {
    redirect(safeCallbackUrl);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(circle at 15% 20%, hsl(var(--primary) / 0.18) 0, transparent 34%), radial-gradient(circle at 85% 75%, hsl(var(--primary) / 0.12) 0, transparent 30%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'linear-gradient(to bottom, black, transparent 88%)',
        }}
      />

      <div className="relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-8 px-5 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] lg:gap-14 lg:px-8">
        <section className="min-w-0 py-4 lg:py-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Herta Community OS
          </div>

          <div className="mt-6 flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary text-lg font-bold text-primary-foreground shadow-card">
              H
            </div>
            <div>
              <p className="font-semibold">Herta Studio</p>
              <p className="text-xs text-muted">Discord Operations Console</p>
            </div>
          </div>

          <h1 className="mt-7 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            Discord運用を、
            <span className="text-primary">ひとつの場所</span>から。
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted sm:text-base">
            Moderation、Plugin、Automation、監視をHertaらしい一貫した操作で管理。
            JSONの柔軟性を残しながら、日常運用はわかりやすいUIで完結できます。
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-border bg-surface/80 p-4 backdrop-blur-sm"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-sm font-semibold">{feature.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{feature.description}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-5 hidden items-center gap-4 rounded-2xl border border-border bg-surface/60 px-4 py-3 text-xs text-muted backdrop-blur-sm sm:flex">
            <span className="inline-flex items-center gap-2 text-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Secure Discord OAuth
            </span>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <span>管理権限を持つGuildのみ表示</span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              Herta Studio
            </span>
          </div>
        </section>

        <section className="w-full min-w-0 lg:justify-self-end">
          <div className="rounded-3xl border border-border bg-surface/95 p-5 shadow-card backdrop-blur-xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Studio Access
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">おかえりなさい</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Discordアカウントで安全にHerta Studioへ接続します。
                </p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-primary">
                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500"
              >
                ログインに失敗しました。Discordとの接続を確認して、もう一度お試しください。
              </div>
            ) : null}

            <form action={signInWithDiscord} className="mt-6">
              <input type="hidden" name="callbackUrl" value={safeCallbackUrl} />
              <button
                type="submit"
                className="group flex w-full items-center justify-between gap-3 rounded-2xl bg-[#5865F2] px-4 py-3.5 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <span className="inline-flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                    <DiscordIcon className="h-5 w-5" />
                  </span>
                  Discordでログイン
                </span>
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </form>

            <div className="mt-5 space-y-3 rounded-2xl border border-border bg-background p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium">必要なGuildだけを表示</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    あなたが管理可能なDiscordサーバーだけをHerta Studioへ表示します。
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 border-t border-border pt-3">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">Bot Tokenはブラウザへ渡しません</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    Channel・Role・User候補はHerta内部API経由で安全に取得します。
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-5 text-center text-xs leading-5 text-muted">
              続行するとDiscord OAuthを使用して認証します。
              <br />
              Herta. — Discord Community OS
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
