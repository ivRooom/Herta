import { redirect } from 'next/navigation';
import {
  CircleAlert,
  KeyRound,
  Link2,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { auth } from '@/auth';
import { SignOutButton } from '@/components/sign-out-button';
import { signInWithDiscord } from '@/lib/actions';
import { STUDIO_ACCOUNT_NAV_ITEM } from '@/lib/studio-navigation';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=${STUDIO_ACCOUNT_NAV_ITEM.href}`);

  const { name, email, image, id } = session.user;
  const displayName = name?.trim() || 'Herta User';
  const reconnectRequired = session.error === 'RefreshAccessTokenError';

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
        <div className="border-b border-border bg-gradient-to-br from-primary/10 via-transparent to-violet-500/10 px-5 py-6 sm:px-7 sm:py-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt={displayName}
                  width={64}
                  height={64}
                  className="h-16 w-16 shrink-0 rounded-2xl border border-border object-cover shadow-sm"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
                  {displayName.slice(0, 1).toUpperCase() || 'H'}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Account Center
                </p>
                <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                  {displayName}
                </h1>
                <p className="mt-1 text-sm text-muted">
                  DiscordアカウントとHerta Studioセッションを管理します。
                </p>
              </div>
            </div>
            <span
              className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                reconnectRequired
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
              }`}
            >
              {reconnectRequired ? (
                <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {reconnectRequired ? '再接続が必要' : 'Discord連携 有効'}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserRound className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Discord Identity</h2>
              <p className="text-xs text-muted">OAuthから取得した本人確認情報</p>
            </div>
          </div>

          <dl className="mt-5 divide-y divide-border rounded-2xl border border-border bg-background/60 px-4">
            <IdentityRow icon={UserRound} label="表示名" value={displayName} />
            <IdentityRow icon={Mail} label="メールアドレス" value={email || '未取得'} />
            <IdentityRow icon={KeyRound} label="Discord User ID" value={id || '未取得'} mono />
          </dl>

          <p className="mt-4 text-xs leading-5 text-muted">
            表示名やメールアドレスはDiscord側のアカウント情報に基づきます。Herta Studioから直接変更は行いません。
          </p>
        </section>

        <section className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                reconnectRequired
                  ? 'bg-amber-500/10 text-amber-500'
                  : 'bg-emerald-500/10 text-emerald-500'
              }`}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Discord Connection</h2>
              <p className="text-xs text-muted">管理可能なGuildへのアクセス状態</p>
            </div>
          </div>

          {reconnectRequired ? (
            <div role="alert" className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-amber-500">Discordの再認証が必要です</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    アクセストークンを更新できませんでした。再接続すると管理可能なサーバー一覧を再取得できます。
                  </p>
                </div>
              </div>
              <form action={signInWithDiscord} className="mt-4">
                <input type="hidden" name="callbackUrl" value={STUDIO_ACCOUNT_NAV_ITEM.href} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-sm font-semibold text-black transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Discordを再接続
                </button>
              </form>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-emerald-500">接続は正常です</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Discord OAuthセッションを利用して、管理可能なサーバー情報へアクセスできます。
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              セッションとセキュリティ
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">
              DiscordのAccess Token / Refresh TokenやBot Tokenはこの画面へ表示せず、ブラウザにも公開しません。ログアウトすると現在のHerta Studioセッションを終了します。
            </p>
          </div>
          <SignOutButton />
        </div>
      </section>
    </div>
  );
}

function IdentityRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <dt className="flex items-center gap-2 text-xs font-medium text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className={`break-all text-sm ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
