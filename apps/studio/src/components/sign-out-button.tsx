import { LogOut } from 'lucide-react';
import { signOutAction } from '@/lib/actions';

/** ログアウトボタン (Server Action を呼び出す) */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        aria-label="ログアウト"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface p-2 text-sm font-medium text-muted transition-colors hover:bg-background hover:text-foreground sm:px-3 sm:py-1.5"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">ログアウト</span>
      </button>
    </form>
  );
}
