import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { signInWithDiscord } from '@/lib/actions';
import { DiscordIcon } from '@/components/discord-icon';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const { callbackUrl, error } = await searchParams;

  if (session?.user) {
    redirect(callbackUrl || '/dashboard');
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-lg font-bold text-background">
            H
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Herta Studio</h1>
          <p className="mt-2 text-sm text-muted">Discord コミュニティ管理ダッシュボード</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          {error ? (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              ログインに失敗しました。もう一度お試しください。
            </div>
          ) : null}

          <form action={signInWithDiscord}>
            <input type="hidden" name="callbackUrl" value={callbackUrl || '/dashboard'} />
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <DiscordIcon className="h-5 w-5" />
              Discord でログイン
            </button>
          </form>

          <p className="mt-4 text-center text-xs leading-relaxed text-muted">
            ログインすると、あなたが管理者権限を持つ
            <br />
            Discord サーバーのみが表示されます。
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted">Herta. — Discord Community OS</p>
      </div>
    </main>
  );
}
