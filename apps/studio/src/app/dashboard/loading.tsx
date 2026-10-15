/**
 * サイドバー遷移・タブ切り替え(searchParams変更)の両方で、配下のpage.tsxが
 * Discord Guild一覧の再取得(短期キャッシュ、@/lib/guilds.ts参照)やDBクエリを
 * 終えるまでの間、画面がフリーズして見えないように即時表示するスケルトン。
 * app/dashboard配下でより具体的なloading.tsxが無い全ページ(community,
 * analytics, guildsなど)に自動で適用される。
 */
export default function DashboardLoading() {
  return (
    <>
      <span className="sr-only" role="status">
        読み込み中
      </span>
      <div className="animate-pulse space-y-6" aria-hidden="true">
        <div className="space-y-2">
          <div className="h-6 w-48 rounded-lg bg-surface" />
          <div className="h-4 w-72 rounded-lg bg-surface/70" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 rounded-2xl border border-border bg-surface/80 p-4">
              <div className="h-3 w-20 rounded bg-background/60" />
              <div className="mt-3 h-6 w-16 rounded bg-background/60" />
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-surface/80 p-6">
          <div className="h-5 w-40 rounded bg-background/60" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-10 rounded-xl bg-background/60" />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
