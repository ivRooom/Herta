import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  FileJson2,
  KeyRound,
  PackagePlus,
  Puzzle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export default function CustomPluginsPage() {
  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Studio Next
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Puzzle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Custom Plugin Hub
              </h1>
              <p className="mt-1 text-sm text-muted">
                Hertaを自分たちの運用に合わせて拡張するための次世代Plugin基盤
              </p>
            </div>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-muted">
            現在は公式Pluginを安全に配布する段階です。次Phaseでは署名付きPlugin
            Package、権限宣言、Guild単位インストール、Studio設定UIまで一つの導線で扱えるようにします。
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <RoadmapCard
          icon={FileJson2}
          title="Manifest & SDK"
          description="commands・events・permissions・config schemaをmanifestで宣言し、Herta SDKで実装します。"
          status="基盤あり"
        />
        <RoadmapCard
          icon={KeyRound}
          title="署名と権限境界"
          description="配布物の署名、依存関係、許可するDiscord操作をインストール前に検証します。"
          status="次Phase"
        />
        <RoadmapCard
          icon={PackagePlus}
          title="Upload / Registry"
          description="ZIPまたはRegistryからPluginを追加し、Guildごとに有効化・更新・ロールバックします。"
          status="設計中"
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">予定しているインストールフロー</h2>
          </div>
          <ol className="mt-5 space-y-4">
            {[
              ['1', 'Plugin Packageを検証', 'manifest、署名、互換Version、依存Pluginを検査'],
              ['2', '要求権限を確認', 'Message管理やRole管理など、実際に必要なDiscord権限を表示'],
              [
                '3',
                'Guildへインストール',
                'Guild単位でenableし、config schemaからStudio設定画面を生成',
              ],
              ['4', '安全に更新', 'version履歴・監査ログ・rollbackで壊れたPluginを切り戻し'],
            ].map(([number, title, description]) => (
              <li key={number} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                  {number}
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
          <ShieldCheck className="h-6 w-6 text-emerald-400" />
          <h2 className="mt-4 font-semibold">安全性を最優先</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            任意コードをそのままBot本体へ読み込む方式にはしません。権限宣言、互換性検証、監査ログ、将来のsandbox実行を前提に設計します。
          </p>
          <Link
            href="/dashboard/guilds"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            現在の公式Pluginを見る <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function RoadmapCard({
  icon: Icon,
  title,
  description,
  status,
}: {
  icon: typeof Puzzle;
  title: string;
  description: string;
  status: string;
}) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted">
          {status}
        </span>
      </div>
      <h2 className="mt-4 font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
    </article>
  );
}
