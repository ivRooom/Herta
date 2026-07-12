import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

export default function GuildNotFound() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
      <ShieldAlert className="h-8 w-8 text-muted" />
      <p className="mt-4 font-medium">このサーバーにアクセスできません</p>
      <p className="mt-1 max-w-sm text-sm text-muted">
        サーバーが存在しないか、あなたに「管理者」または「サーバー管理」権限がありません。
      </p>
      <Link
        href="/dashboard/guilds"
        className="mt-6 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-background"
      >
        サーバー一覧へ戻る
      </Link>
    </div>
  );
}
