import { LogOut } from 'lucide-react';
import { signOutAction } from '@/lib/actions';

/** ログアウトボタン (Server Action を呼び出す) */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground hover:bg-background"
      >
        <LogOut className="h-4 w-4" />
        ログアウト
      </button>
    </form>
  );
}
