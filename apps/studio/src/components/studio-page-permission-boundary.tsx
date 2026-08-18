import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { authorizeStudioPageView } from '@/lib/studio-page-access';
import type { StudioPageId } from '@/lib/studio-policy-resources';

export async function StudioPagePermissionBoundary({
  guildId,
  pageId,
  children,
}: {
  guildId: string;
  pageId: StudioPageId;
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) notFound();

  const authorization = await authorizeStudioPageView(guildId, session.user.id, pageId);
  if (authorization.ok) return children;

  const permissionDenied = authorization.response.status === 403;
  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="text-sm text-muted transition-colors hover:text-foreground"
      >
        ← サーバー概要へ戻る
      </Link>
      <section
        className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6"
        role={permissionDenied ? 'alert' : undefined}
      >
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold">
              {permissionDenied ? 'このページを開く権限がありません' : '権限を確認できませんでした'}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              {permissionDenied
                ? 'Herta IAM Policyでこのページの閲覧が許可されていません。Access ControlのPolicy設定を確認してください。'
                : 'Discordまたは権限データを安全に確認できなかったため、ページ表示を拒否しています。'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
