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
  const players = new Map<string, { userId: string; draws: number; agents: Map<string, number> }>();
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
      if (typeof item.userId === 'string') {
        const userId = item.userId;
        const player = players.get(userId) ?? {
          userId, draws: 0, agents: new Map<string, number>(),
        };
        player.draws++;
        player.agents.set(id, (player.agents.get(id) ?? 0) + 1);
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
    players: [...players.values()]
      .map((p) => ({
        userId: p.userId,
        draws: p.draws,
        agentCounts: [...p.agents]
          .map(([agentId, count]) => ({ agentId, count }))
          .sort((a, b) => b.count - a.count || a.agentId.localeCompare(b.agentId)),
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

export interface ValorantMatchSample {
  outcome: string;
  roundsWon: number;
  roundsLost: number;
  playerResults: unknown;
  session: { result: unknown };
}
export function aggregateValorantMatchStats(reports: readonly ValorantMatchSample[]) {
  const summary = { total: reports.length, win: 0, loss: 0, draw: 0 };
  const teams = new Map<
    string,
    { name: string; count: number; win: number; loss: number; draw: number }
  >();
  for (const report of reports) {
    const outcome = report.outcome === 'WIN' ? 'win' : report.outcome === 'LOSS' ? 'loss' : 'draw';
    summary[outcome]++;
    const result = Array.isArray(report.session.result) ? report.session.result : [];
    const ids = result.flatMap((entry): string[] =>
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof entry.agentId === 'string'
        ? [entry.agentId]
        : [],
    );
    const name = ids.sort().join(', ');
    if (!name) continue;
    const team = teams.get(name) ?? { name, count: 0, win: 0, loss: 0, draw: 0 };
    team.count++;
    team[outcome]++;
    teams.set(name, team);
  }
  return { ...summary, compositions: [...teams.values()].sort((a, b) => b.count - a.count) };
}
