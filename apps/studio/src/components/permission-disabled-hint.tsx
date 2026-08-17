import type { ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';

export const OWNER_ROOT_PERMISSION_HINT =
  'この操作には OWNER root Role が必要です。サーバー所有者または OWNER root 管理者に権限付与を依頼してください。';

export function PermissionDisabledHint({
  blocked,
  children,
  className = '',
  reason = OWNER_ROOT_PERMISSION_HINT,
}: {
  blocked: boolean;
  children: ReactNode;
  className?: string;
  reason?: string;
}) {
  if (!blocked) return <>{children}</>;

  return (
    <span
      className={`group/permission relative inline-flex ${className}`}
      tabIndex={0}
      aria-label={reason}
    >
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-72 -translate-x-1/2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-medium leading-5 text-foreground opacity-0 shadow-lg transition-opacity group-hover/permission:opacity-100 group-focus-visible/permission:opacity-100"
      >
        {reason}
      </span>
    </span>
  );
}

export function ReadOnlyPermissionNotice({
  reason = OWNER_ROOT_PERMISSION_HINT,
}: {
  reason?: string;
}) {
  return (
    <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
      <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">閲覧専用です</p>
        <p className="mt-0.5 leading-5">{reason}</p>
      </div>
    </div>
  );
}
