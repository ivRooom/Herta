import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardPlus,
  Dice5,
  Layers3,
  ListFilter,
  Sparkles,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { resolvePluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import { aggregateValorantStats, aggregateValorantMatchStats } from '@/lib/valorant-stats';
import {
  parseValorantConsoleFilters,
  valorantConsoleSince,
  VALORANT_CONSOLE_MAPS,
} from '@/lib/valorant-console-filters';
import { ValorantResultsManager } from '@/components/valorant-results-manager';
import { ValorantFrequencyBars, ValorantPickHistory } from '@/components/valorant-stats-visuals';
import {
  ValorantCompactBars,
  ValorantHistoryPreview,
  ValorantRoleDonut,
} from '@/components/valorant-console-widgets';
import { ValorantWinRateTrend } from '@/components/valorant-winrate-trend';
import { defaultValorantAgents } from '@herta/plugin-catalog';

export const dynamic = 'force-dynamic';

const ROLE_NAMES: Record<string, string> = {
  DUELIST: 'デュエリスト',
  CONTROLLER: 'コントローラー',
  INITIATOR: 'イニシエーター',
  SENTINEL: 'センチネル',
  UNKNOWN: '未分類',
};

function ConsoleMetric({
  icon: Icon,
  title,
  value,
  note,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  note: string;
}) {
  return (
    <article className="valorant-panel min-w-0 rounded-2xl p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2 text-violet-300">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <h2 className="truncate text-[11px] font-medium text-muted sm:text-xs">{title}</h2>
      </div>
      <p className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl" title={value}>
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted" title={note}>
        {note}
      </p>
    </article>
  );
}

export default async function ValorantStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{
    page?: string;
    period?: string;
    map?: string;
    mode?: string;
  }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user || !/^\d{17,20}$/.test(guildId)) notFound();
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) notFound();
  const permission = resolvePluginConfigStudioAccess(access.access, guildId, 'valorant', [
    'enabledAgents',
  ]);
  if (!permission.readableConfigPaths.includes('enabledAgents')) notFound();

  const query = await searchParams;
  const filters = parseValorantConsoleFilters(query);
  const since = valorantConsoleSince(filters.period);
  const rows = await prisma.valorantPickSession.findMany({
    where: {
      guildId,
      status: 'COMPLETED',
      ...(since ? { completedAt: { gte: since } } : {}),
      ...(filters.map ? { mapId: filters.map } : {}),
      ...(filters.mode ? { mode: filters.mode } : {}),
    },
    orderBy: { completedAt: 'desc' },
    take: 5001,
    select: {
      id: true,
      mode: true,
      mapId: true,
      completedAt: true,
      candidates: true,
      result: true,
    },
  });
  const data = aggregateValorantStats(rows.slice(0, 5000));
  const matchRows = await prisma.valorantMatchResult.findMany({
    where: {
      guildId,
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(filters.map ? { mapId: filters.map } : {}),
      ...(filters.mode ? { session: { mode: filters.mode } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 5001,
    select: {
      outcome: true,
      roundsWon: true,
      roundsLost: true,
      createdAt: true,
      playerResults: true,
      session: { select: { result: true } },
    },
  });
  const matchData = aggregateValorantMatchStats(matchRows.slice(0, 5000));
  const names = new Map(defaultValorantAgents().map((agent) => [agent.agentId, agent.displayName]));
  const pageParam = query?.page ?? '1';
  const pageNumber = /^\d{1,3}$/.test(pageParam) ? Number(pageParam) : 1;
  const topAgent = data.agents[0];
  const topRole = data.roles[0];
  const winRate =
    matchData.win + matchData.loss > 0
      ? ((matchData.win / (matchData.win + matchData.loss)) * 100).toFixed(1) + '%'
      : '算出不可';
  const periodLabel = filters.period === 'all' ? '全期間' : '直近' + filters.period + '日';
  const compositions = data.compositions.map((team) => ({
    name: team.name
      .split(', ')
      .map((id) => names.get(id) ?? id)
      .join(' / '),
    count: team.count,
  }));

  return (
    <main className="valorant-console relative space-y-4 p-3 sm:p-5 lg:left-1/2 lg:w-[calc(100vw-20rem)] lg:max-w-[1680px] lg:-translate-x-1/2 lg:p-6">
      <header className="relative overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-r from-[#222444] via-[#171b35] to-[#191633] p-4 sm:p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-20 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl"
        />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <Link
              href={'/dashboard/guilds/' + guildId + '/plugins/valorant'}
              className="inline-flex items-center gap-2 text-xs text-violet-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
            >
              <Layers3 className="h-4 w-4" aria-hidden="true" />
              Herta Studio / VALORANT
            </Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              VALORANT <span className="text-violet-300">分析コンソール</span>
            </h1>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-300 sm:text-sm">
              抽選されたエージェント・ロール・構成と、手動登録された試合結果をGuild単位で分析します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-violet-100">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> 抽選履歴・分析
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-teal-400/25 bg-teal-400/10 px-3 py-2 text-teal-100">
              <ClipboardPlus className="h-3.5 w-3.5" aria-hidden="true" /> 手動試合登録
            </span>
          </div>
        </div>
      </header>

      <form
        method="GET"
        aria-label="VALORANT分析のフィルタ"
        className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-[#111a31]/90 p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      >
        <label className="min-w-0 text-xs text-muted">
          <span className="mb-1 flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> 期間
          </span>
          <select name="period" className="input" defaultValue={filters.period}>
            <option value="7">直近7日</option>
            <option value="30">直近30日</option>
            <option value="90">直近90日</option>
            <option value="all">全期間</option>
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted">
          <span className="mb-1 flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5" aria-hidden="true" /> マップ
          </span>
          <select name="map" className="input" defaultValue={filters.map}>
            <option value="">すべてのマップ</option>
            {VALORANT_CONSOLE_MAPS.map((map) => (
              <option key={map} value={map}>
                {map}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted">
          <span className="mb-1 flex items-center gap-1.5">
            <ListFilter className="h-3.5 w-3.5" aria-hidden="true" /> 抽選モード
          </span>
          <select name="mode" className="input" defaultValue={filters.mode}>
            <option value="">すべて</option>
            <option value="RANDOM">完全ランダム</option>
            <option value="TACTICAL">実戦向け</option>
          </select>
        </label>
        <button
          type="submit"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 px-4 text-sm font-semibold text-white transition hover:from-violet-500 hover:to-purple-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-200"
        >
          <ListFilter className="h-4 w-4" aria-hidden="true" /> 適用
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted">
        <p>
          表示範囲: {periodLabel} · {filters.map || '全マップ'} ·{' '}
          {filters.mode === 'RANDOM'
            ? '完全ランダム'
            : filters.mode === 'TACTICAL'
              ? '実戦向け'
              : '全モード'}
        </p>
        <p>抽選は完了日時、勝敗は結果の登録日時（UTC）で絞り込みます。</p>
      </div>

      {(data.smallSample || rows.length > 5000 || matchRows.length > 5000) && (
        <p
          role="status"
          className="rounded-xl border border-amber-300/20 bg-amber-200/5 p-3 text-xs text-amber-100"
        >
          {data.smallSample
            ? '抽選の標本数は30件未満です。割合を優劣や傾向の確証として解釈しないでください。 '
            : ''}
          {rows.length > 5000 || matchRows.length > 5000
            ? '集計は各データの最新5,000件に制限しています。'
            : ''}
        </p>
      )}

      <section
        aria-label="分析の主要指標"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 2xl:grid-cols-6"
      >
        <ConsoleMetric
          icon={Layers3}
          title="完了した抽選"
          value={data.totalDraws.toLocaleString('ja-JP') + '回'}
          note="Guildの抽選セッション"
        />
        <ConsoleMetric
          icon={CheckCircle2}
          title="結果登録数"
          value={matchData.total.toLocaleString('ja-JP') + '試合'}
          note="手動登録された試合のみ"
        />
        <ConsoleMetric
          icon={Trophy}
          title="登録済み勝率"
          value={winRate}
          note={matchData.win + '勝 / ' + matchData.loss + '敗 / ' + matchData.draw + '分'}
        />
        <ConsoleMetric
          icon={Dice5}
          title="最多選出エージェント"
          value={topAgent ? (names.get(topAgent.agentId) ?? topAgent.agentId) : '未記録'}
          note={topAgent ? topAgent.selected + '回選出' : '抽選データなし'}
        />
        <ConsoleMetric
          icon={Activity}
          title="最多選出ロール"
          value={topRole ? (ROLE_NAMES[topRole.name] ?? topRole.name) : '未記録'}
          note={topRole ? topRole.count + '回割当' : '抽選データなし'}
        />
        <ConsoleMetric
          icon={Sparkles}
          title="抽選された組合せ"
          value={data.compositions.length.toLocaleString('ja-JP') + '種'}
          note="実プレイ構成とは別"
        />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <ValorantCompactBars
              title="よく当たるエージェント"
              description="抽選での選出回数トップ5 · メンバー合計"
              items={data.agents.map((agent) => ({
                name: names.get(agent.agentId) ?? agent.agentName,
                count: agent.selected,
              }))}
            />
            <ValorantRoleDonut items={data.roles} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ValorantWinRateTrend days={matchData.daily} />
            <ValorantCompactBars
              title="よく出る構成パターン"
              description="抽選時のAgent組合せ · 試合結果の勝率ではありません"
              items={compositions}
            />
          </div>

          <ValorantHistoryPreview rows={rows.slice(0, 5000)} labels={names} />

          <details className="valorant-panel group rounded-2xl p-4 sm:p-5" id="valorant-details">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-300" aria-hidden="true" />
                詳細分析・全抽選履歴を表示
              </span>
              <ChevronDown
                className="h-4 w-4 text-muted transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              選出率＝エージェント選出回数÷そのエージェントが候補に入ったセッション数。
              完全ランダムと戦術構成では候補条件が異なります。
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[450px] text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th scope="col" className="p-2">
                      Agent
                    </th>
                    <th scope="col" className="p-2">
                      選出数
                    </th>
                    <th scope="col" className="p-2">
                      候補入り
                    </th>
                    <th scope="col" className="p-2">
                      選出率
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => (
                    <tr key={agent.agentId} className="border-t border-border/60">
                      <td className="p-2">{names.get(agent.agentId) ?? agent.agentName}</td>
                      <td className="p-2 tabular-nums">{agent.selected}</td>
                      <td className="p-2 tabular-nums">{agent.eligibleSessions}</td>
                      <td className="p-2 tabular-nums">
                        {agent.selectedPerEligibleSession === null
                          ? '算出不可'
                          : (agent.selectedPerEligibleSession * 100).toFixed(1) + '%'}
                      </td>
                    </tr>
                  ))}
                  {data.agents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-3 text-muted">
                        集計対象がありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ValorantFrequencyBars title="抽選モード別" items={data.modes} />
              <ValorantFrequencyBars title="マップ別抽選数" items={data.maps} />
              <ValorantFrequencyBars title="日別抽選数（UTC）" items={data.daily} />
              <ValorantFrequencyBars title="週別抽選数（UTC月曜開始）" items={data.weekly} />
              <ValorantFrequencyBars title="月別抽選数（UTC）" items={data.monthly} />
              <ValorantFrequencyBars
                title="登録済みの勝敗"
                items={[
                  { name: '勝利', count: matchData.win },
                  { name: '敗北', count: matchData.loss },
                  { name: '引分', count: matchData.draw },
                ]}
              />
            </div>
            <div className="mt-4">
              <ValorantPickHistory
                rows={rows.slice(0, 5000)}
                page={pageNumber}
                displayNames={names}
                filters={filters}
              />
            </div>
            <section className="mt-4 rounded-xl border border-border p-3">
              <h3 className="text-sm font-semibold">メンバー別の抽選傾向</h3>
              <p className="mt-1 text-xs text-muted">
                Guild認可画面内のみ。個人識別子は90日匿名化の対象で、匿名化済みの記録は集計しません。
              </p>
              <ul className="mt-3 space-y-2 text-xs">
                {data.players.slice(0, 100).map((player) => (
                  <li key={player.userId} className="border-t border-border/70 pt-2">
                    <p className="break-all font-medium">
                      {player.userId} · {player.draws}回選出
                    </p>
                    <p className="mt-1 text-muted">
                      Agent:{' '}
                      {player.agentCounts
                        .map((a) => (names.get(a.agentId) ?? a.agentId) + ' ' + a.count + '回')
                        .join(' / ')}
                    </p>
                    <p className="mt-1 text-muted">
                      Role:{' '}
                      {player.roleCounts
                        .map((r) => (ROLE_NAMES[r.name] ?? r.name) + ' ' + r.count + '回')
                        .join(' / ')}
                    </p>
                  </li>
                ))}
                {data.players.length === 0 && (
                  <li className="text-muted">メンバー別の有効な記録はありません。</li>
                )}
              </ul>
            </section>
          </details>

          <section
            className="valorant-panel rounded-2xl p-4 sm:p-5"
            aria-labelledby="valorant-commands"
          >
            <h2 id="valorant-commands" className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardPlus className="h-4 w-4 text-violet-300" aria-hidden="true" />
              Discordコマンドで確認
            </h2>
            <p className="mt-1 text-xs text-muted">
              Guildの抽選統計は非公開応答です。外部ランク/RRと結果登録済み勝率は別指標です。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <code className="rounded-lg border border-border bg-[#101a32] p-3 text-xs text-violet-200">
                /valorant picks
              </code>
              <code className="rounded-lg border border-border bg-[#101a32] p-3 text-xs text-violet-200">
                /valorant random
              </code>
              <code className="rounded-lg border border-border bg-[#101a32] p-3 text-xs text-violet-200">
                /valorant stats
              </code>
            </div>
            <p className="mt-2 text-xs text-muted">
              構成履歴の専用コマンド・Discordでの結果登録・VCT/上位ランクの統計表示は別Issueで管理しています。
            </p>
          </section>
        </div>

        <aside
          className="min-w-0 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto"
          aria-label="試合結果登録"
        >
          <ValorantResultsManager guildId={guildId} compact />
        </aside>
      </div>
    </main>
  );
}
