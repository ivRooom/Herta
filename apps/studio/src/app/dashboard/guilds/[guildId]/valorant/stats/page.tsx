import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { resolvePluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import { aggregateValorantStats, aggregateValorantMatchStats } from '@/lib/valorant-stats';
import { ValorantResultsManager } from '@/components/valorant-results-manager';
import { defaultValorantAgents } from '@herta/plugin-catalog';

export const dynamic = 'force-dynamic';

export default async function ValorantStatsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
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
  const rows = await prisma.valorantPickSession.findMany({
    where: { guildId, status: 'COMPLETED' },
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
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take: 5001,
    select: {
      outcome: true,
      roundsWon: true,
      roundsLost: true,
      playerResults: true,
      session: { select: { result: true } },
    },
  });
  const matchData = aggregateValorantMatchStats(matchRows.slice(0, 5000));
  const displayNames = new Map(defaultValorantAgents().map((a) => [a.agentId, a.displayName]));
  return (
    <main className="space-y-7">
      <Link
        className="text-sm text-muted hover:underline"
        href={'/dashboard/guilds/' + guildId + '/plugins/valorant'}
      >
        ← VALORANT設定へ戻る
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">VALORANT 抽選統計</h1>
        <p className="mt-2 text-sm text-muted">
          Guild内の完了済み抽選（最大5,000件）。総抽選回数: {data.totalDraws}
        </p>
      </header>
      {(data.smallSample || rows.length > 5000) && (
        <p role="status" className="rounded-xl border border-border p-4 text-sm">
          {data.smallSample
            ? '標本数が30件未満のため、選出率に意味のある傾向があるとは判断できません。'
            : ''}
          {rows.length > 5000 ? '集計は最新5,000件に制限しています。' : ''}
        </p>
      )}
      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold">エージェント別選出率</h2>
        <p className="mb-3 text-xs text-muted">
          選出率=選出回数÷候補入り抽選回数。実戦向け構成は候補の選出機会に偏りがあるため、完全ランダムと同じ確率とは解釈できません。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-2">Agent</th>
                <th className="p-2">選出</th>
                <th className="p-2">候補入り</th>
                <th className="p-2">選出率</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((agent) => (
                <tr key={agent.agentId} className="border-t border-border">
                  <td className="p-2">{displayNames.get(agent.agentId) ?? agent.agentName}</td>
                  <td className="p-2">{agent.selected}</td>
                  <td className="p-2">{agent.eligibleSessions}</td>
                  <td className="p-2">
                    {agent.selectedPerEligibleSession === null
                      ? '算出不可'
                      : (agent.selectedPerEligibleSession * 100).toFixed(1) + '%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            ['抽選モード', data.modes],
            ['マップ別', data.maps],
            ['よく生成された構成', data.compositions],
            ['日別推移（UTC）', data.daily],
            ['週別推移（UTC月曜開始）', data.weekly],
            ['月別推移（UTC）', data.monthly],
          ] as const
        ).map(([title, items]) => (
          <section key={title} className="rounded-xl border border-border p-4">
            <h2 className="mb-3 font-semibold">{title}</h2>
            <ul className="space-y-1 text-sm">
              {items.length ? (
                items.slice(0, 50).map(({ name, count }) => (
                  <li key={name} className="flex justify-between gap-4 break-all">
                    <span>{name}</span>
                    <span>{count}件</span>
                  </li>
                ))
              ) : (
                <li className="text-muted">記録なし</li>
              )}
            </ul>
          </section>
        ))}
      </div>
      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold">試合結果分析（手動登録）</h2>
        <p className="text-sm">
          登録 {matchData.total}試合 / 勝利 {matchData.win} / 敗北 {matchData.loss} / 引分{' '}
          {matchData.draw}
        </p>
        <p className="mt-2 text-sm">
          勝率（引分除外）:
          {matchData.win + matchData.loss
            ? ((matchData.win / (matchData.win + matchData.loss)) * 100).toFixed(1) + '%'
            : '算出不可'}
        </p>
        <p className="mt-2 text-xs text-muted">
          少数サンプルは傾向と解釈しません。抽選エージェントと実使用エージェントは別管理です。
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {matchData.compositions.slice(0, 20).map((t) => (
            <li key={t.name}>
              {t.name}: {t.win}勝 / {t.loss}敗 / {t.draw}分（{t.count}件）
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold">プレイヤー別の選出傾向</h2>
        <p className="mb-2 text-xs text-muted">
          サーバー管理権限で表示。識別子は収集期間内のDiscordユーザーIDです。
        </p>
        <ul className="space-y-3 text-sm">
          {data.players.slice(0, 100).map((player) => (
            <li key={player.userId} className="border-t border-border pt-3">
              <span className="font-medium">
                {player.userId}（{player.draws}回）
              </span>
              <p className="mt-1 text-muted">
                {player.agentCounts.map((a) => a.agentId + ': ' + a.count + '回').join(' / ')}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <ValorantResultsManager guildId={guildId} />
    </main>
  );
}
