import { describe, expect, it } from 'vitest';
import { aggregateValorantStats } from './valorant-stats.js';

/**
 * 契約テスト (S6-PLAN §5.2): Studio の
 * `apps/studio/tests/valorant-stats.test.ts` の fixture を複製し、
 * Bot 側移植が同一入力で同一出力を返すことを固定する。
 * 統計定義を変更するときは Studio と Bot の両テストを同時に変えること。
 * 試合結果集計 (`aggregateValorantMatchStats`) の fixture は S6 初版の
 * 対象外のため複製していない。
 */
const sample = (id: string, mode: string, agentId: string) => ({
  id,
  mode,
  mapId: mode === 'TACTICAL' ? 'Ascent' : null,
  completedAt: new Date('2026-10-30T00:00:00.000Z'),
  candidates: [
    { agentId: 'jett', agentName: 'Jett' },
    { agentId: 'omen', agentName: 'Omen' },
  ],
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
      selected: 1,
      eligibleSessions: 2,
      selectedPerEligibleSession: 0.5,
    });
    expect(stats.players[0]).toMatchObject({
      userId: 'user-1',
      draws: 2,
      roleCounts: [
        { name: 'CONTROLLER', count: 1 },
        { name: 'DUELIST', count: 1 },
      ],
    });
    expect(stats.roles).toEqual([
      { name: 'CONTROLLER', count: 1 },
      { name: 'DUELIST', count: 1 },
    ]);
    expect(stats.daily).toEqual([{ name: '2026-10-30', count: 2 }]);
    expect(stats.smallSample).toBe(true);
  });
  it('never fabricates a selection denominator for missing candidate snapshots', () => {
    const stats = aggregateValorantStats([
      { ...sample('3', 'TACTICAL', 'jett'), candidates: null },
    ]);
    expect(stats.agents[0]).toMatchObject({
      selected: 1,
      eligibleSessions: 0,
      selectedPerEligibleSession: null,
    });
  });
  it('classifies unknown or custom agent IDs without inventing a canonical role', () => {
    const stats = aggregateValorantStats([
      {
        ...sample('custom', 'RANDOM', 'custom-agent'),
        result: [{ userId: 'user-2', agentId: 'custom-agent' }],
      },
    ]);
    expect(stats.roles).toEqual([{ name: 'UNKNOWN', count: 1 }]);
    expect(stats.players[0]?.roleCounts).toEqual([{ name: 'UNKNOWN', count: 1 }]);
  });
  it('preserves aggregate agent frequency after identifiers are anonymized', () => {
    const draw = sample('retained', 'RANDOM', 'jett');
    const output = aggregateValorantStats([{ ...draw, result: [{ agentId: 'jett' }] }]);
    expect(output.agents.find((a) => a.agentId === 'jett')?.selected).toBe(1);
    expect(output.players).toHaveLength(0);
  });
});
