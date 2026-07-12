import { AlertTriangle } from 'lucide-react';
import { signInWithDiscord } from '@/lib/actions';

/** Discord トークンが失効した際に再ログインを促す通知 */
export function ReconnectNotice() {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <h2 className="font-medium">Discord への再接続が必要です</h2>
          <p className="mt-1 text-sm text-muted">
            セッションの有効期限が切れました。再度ログインしてサーバー一覧を取得してください。
          </p>
          <form action={signInWithDiscord} className="mt-4">
            <input type="hidden" name="callbackUrl" value="/dashboard" />
            <button
              type="submit"
              className="rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Discord で再ログイン
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
