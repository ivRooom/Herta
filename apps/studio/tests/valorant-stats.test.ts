import { describe, expect, it } from 'vitest';
import { aggregateValorantStats, aggregateValorantMatchStats } from '../src/lib/valorant-stats';

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
  it('groups manual outcomes by original pick composition', () => {
    const output = aggregateValorantMatchStats([
      {
        outcome: 'WIN',
        roundsWon: 13,
        roundsLost: 7,
        playerResults: [{ userId: 'sample', agentId: 'omen' }],
        session: { result: [{ userId: 'sample', agentId: 'jett' }] },
      },
    ]);
    expect(output.win).toBe(1);
    expect(output.compositions[0]).toMatchObject({ name: 'omen', count: 1, win: 1 });
    expect(output.pickedCompositions[0]).toMatchObject({ name: 'jett', count: 1, win: 1 });
  });
  it('counts wins only among registered decisive results and groups by registration UTC date', () => {
    const make = (outcome: string, date: Date | null) => ({
      outcome,
      roundsWon: 13,
      roundsLost: 10,
      playerResults: [],
      session: { result: [] },
      createdAt: date,
    });
    const result = aggregateValorantMatchStats([
      make('WIN', new Date('2026-11-01T23:59:59.999Z')),
      make('LOSS', new Date('2026-11-01T01:00:00.000Z')),
      make('DRAW', new Date('2026-11-01T11:00:00.000Z')),
      make('DRAW', new Date('2026-11-02T00:00:00.000Z')),
      make('WIN', null),
      make('LOSS', new Date(Number.NaN)),
    ]);
    expect(result).toMatchObject({ total: 6, win: 2, loss: 2, draw: 2 });
    expect(result.daily).toEqual([
      { date: '2026-11-01', total: 3, win: 1, loss: 1, draw: 1, winRate: 0.5 },
      { date: '2026-11-02', total: 1, win: 0, loss: 0, draw: 1, winRate: null },
    ]);
  });

  it('does not invent registration dates for legacy match records', () => {
    const output = aggregateValorantMatchStats([
      {
        outcome: 'WIN',
        roundsWon: 13,
        roundsLost: 8,
        playerResults: [],
        session: { result: [] },
      },
    ]);
    expect(output.win).toBe(1);
    expect(output.daily).toEqual([]);
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
