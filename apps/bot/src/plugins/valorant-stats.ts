import { valorantRoleForAgentId } from '@herta/plugin-catalog';

/**
 * VALORANT 抽選統計の Bot 側移植 (S6-H1、Herta #1050)。
 *
 * 定義の正本は Studio の `apps/studio/src/lib/valorant-stats.ts` の
 * `aggregateValorantStats` で、このファイルはその純関数の移植である。
 * ポータル統計 (POST /portal/valorant/stats) はここで集計済み JSON を
 * 返し、生の抽選行を呼び出し側へ渡して再集計させない (定義の分裂防止)。
 *
 * 運用ルール (S6-PLAN §5.2): 統計定義を変更するときは Studio と Bot の
 * 両方のテスト fixture を同時に変更すること。Bot 側の契約テストは
 * `valorant-stats.test.ts` で、Studio の
 * `apps/studio/tests/valorant-stats.test.ts` の fixture を複製して
 * 同一入力 → 同一出力を固定している。
 *
 * 読み取り条件も Studio の stats route と揃える: COMPLETED かつ
 * mode != WEREWOLF (人狼セッションを通常統計へ混ぜない)、新しい順、
 * 最大 5,000 件、保持期間 90 日 (超過分は呼び出し側が `truncated`
 * フラグで返す)。このモジュール自体は集計だけを行い、DB 読み取りは
 * `valorant-portal-api.ts` が担う。
 *
 * 試合結果の勝率集計 (`aggregateValorantMatchStats`) は S6 初版の
 * 対象外のため移植しない (S6-PLAN §8-8)。
 */

export interface DrawSample {
  id: string;
  mode: string;
  mapId: string | null;
  completedAt: Date | null;
  candidates: unknown;
  result: unknown;
}
export interface AgentStats {
  agentId: string;
  agentName: string;
  selected: number;
  eligibleSessions: number;
  selectedPerEligibleSession: number | null;
}
export function aggregateValorantStats(draws: readonly DrawSample[]) {
  const agents = new Map<string, AgentStats>();
  const players = new Map<
    string,
    { userId: string; draws: number; agents: Map<string, number>; roles: Map<string, number> }
  >();
  const roles = new Map<string, number>();
  const maps = new Map<string, number>();
  const modes = new Map<string, number>();
  const teams = new Map<string, number>();
  const daily = new Map<string, number>();
  const weekly = new Map<string, number>();
  const monthly = new Map<string, number>();
  for (const draw of draws) {
    const assigned = Array.isArray(draw.result)
      ? draw.result.filter(
          (entry): entry is Record<string, unknown> =>
            entry !== null &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            typeof entry.agentId === 'string',
        )
      : [];
    const candidateList = Array.isArray(draw.candidates) ? draw.candidates : [];
    // An eligible session is counted only once per agent; it is NOT a player-level probability.
    const eligible = new Set(
      candidateList.flatMap((entry): string[] =>
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        typeof entry.agentId === 'string'
          ? [entry.agentId]
          : [],
      ),
    );
    const names = new Map(
      candidateList.flatMap((entry): [string, string][] =>
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        typeof entry.agentId === 'string' &&
        typeof entry.agentName === 'string'
          ? [[entry.agentId, entry.agentName]]
          : [],
      ),
    );
    for (const id of eligible) {
      const row = agents.get(id) ?? {
        agentId: id,
        agentName: names.get(id) ?? id,
        selected: 0,
        eligibleSessions: 0,
        selectedPerEligibleSession: null,
      };
      row.eligibleSessions++;
      agents.set(id, row);
    }
    for (const item of assigned) {
      const id = item.agentId as string;
      const row = agents.get(id) ?? {
        agentId: id,
        agentName: names.get(id) ?? id,
        selected: 0,
        eligibleSessions: 0,
        selectedPerEligibleSession: null,
      };
      row.selected++;
      agents.set(id, row);
      const role = valorantRoleForAgentId(id);
      roles.set(role, (roles.get(role) ?? 0) + 1);
      if (typeof item.userId === 'string') {
        const userId = item.userId;
        const player = players.get(userId) ?? {
          userId,
          draws: 0,
          agents: new Map<string, number>(),
          roles: new Map<string, number>(),
        };
        player.draws++;
        player.agents.set(id, (player.agents.get(id) ?? 0) + 1);
        player.roles.set(role, (player.roles.get(role) ?? 0) + 1);
        players.set(userId, player);
      }
    }
    maps.set(draw.mapId ?? '指定なし', (maps.get(draw.mapId ?? '指定なし') ?? 0) + 1);
    modes.set(draw.mode, (modes.get(draw.mode) ?? 0) + 1);
    const team = assigned
      .map((entry) => entry.agentId as string)
      .sort()
      .join(', ');
    if (team) teams.set(team, (teams.get(team) ?? 0) + 1);
    if (draw.completedAt) {
      const date = draw.completedAt.toISOString().slice(0, 10);
      daily.set(date, (daily.get(date) ?? 0) + 1);
      monthly.set(date.slice(0, 7), (monthly.get(date.slice(0, 7)) ?? 0) + 1);
      const monday = new Date(draw.completedAt);
      monday.setUTCHours(0, 0, 0, 0);
      const weekday = (monday.getUTCDay() + 6) % 7;
      monday.setUTCDate(monday.getUTCDate() - weekday);
      const week = monday.toISOString().slice(0, 10);
      weekly.set(week, (weekly.get(week) ?? 0) + 1);
    }
  }
  const pairs = (map: Map<string, number>) =>
    [...map]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    totalDraws: draws.length,
    smallSample: draws.length < 30,
    agents: [...agents.values()]
      .map((a) => ({
        ...a,
        selectedPerEligibleSession: a.eligibleSessions ? a.selected / a.eligibleSessions : null,
      }))
      .sort((a, b) => b.selected - a.selected || a.agentId.localeCompare(b.agentId)),
    roles: pairs(roles),
    players: [...players.values()]
      .map((p) => ({
        userId: p.userId,
        draws: p.draws,
        agentCounts: [...p.agents]
          .map(([agentId, count]) => ({ agentId, count }))
          .sort((a, b) => b.count - a.count || a.agentId.localeCompare(b.agentId)),
        roleCounts: [...p.roles]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.draws - a.draws),
    maps: pairs(maps),
    modes: pairs(modes),
    compositions: pairs(teams),
    daily: pairs(daily).sort((a, b) => a.name.localeCompare(b.name)),
    weekly: pairs(weekly).sort((a, b) => a.name.localeCompare(b.name)),
    monthly: pairs(monthly).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
