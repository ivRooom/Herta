import { describe, expect, it } from 'vitest';
import { aggregateValorantStats } from './valorant-stats.js';

const sample = (id: string, mode: string, agentId: string) => ({
  id, mode, mapId: mode === 'TACTICAL' ? 'Ascent' : null,
  completedAt: new Date('2026-10-30T00:00:00.000Z'),
  candidates: [{ agentId: 'jett', agentName: 'Jett' }, { agentId: 'omen', agentName: 'Omen' }],
  result: [{ userId: 'user-1', agentId, displayName: agentId }],
});
describe('VALORANT stats aggregation', () => {
  it('uses each exposed session once per candidate, not total draws as the denominator', () => {
    const stats = aggregateValorantStats([
      sample('1', 'RANDOM', 'jett'),
      sample('2', 'RANDOM', 'omen'),
    ]);
    expect(stats.totalDraws).toBe(2);
    expect(stats.agents.find((a) => a.agentId === 'jett')).toMatchObject({
      selected: 1, eligibleSessions: 2, selectedPerEligibleSession: 0.5,
    });
    expect(stats.players[0]).toMatchObject({ userId: 'user-1', draws: 2 });
    expect(stats.daily).toEqual([{ name: '2026-10-30', count: 2 }]);
    expect(stats.smallSample).toBe(true);
  });
  it('never fabricates a selection denominator for missing candidate snapshots', () => {
    const stats = aggregateValorantStats([{ ...sample('3', 'TACTICAL', 'jett'), candidates: null }]);
    expect(stats.agents[0]).toMatchObject({
      selected: 1, eligibleSessions: 0, selectedPerEligibleSession: null,
    });
  });
});
