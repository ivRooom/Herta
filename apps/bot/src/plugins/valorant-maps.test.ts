import { describe, expect, it } from 'vitest';
import {
  evidenceWeights,
  pickTacticalAgents,
  tacticalMapPlan,
  VALORANT_COMPOSITION_PATCH,
  VALORANT_COMPOSITION_VERSION,
  VALORANT_MAPS,
  type TacticalCompositionEvidence,
} from './valorant-maps.js';

const agents = [
  'Jett',
  'Raze',
  'Yoru',
  'Neon',
  'Omen',
  'Astra',
  'Brimstone',
  'Viper',
  'Harbor',
  'Sova',
  'Fade',
  'Gekko',
  'Skye',
  'KAY/O',
  'Breach',
  'Killjoy',
  'Cypher',
  'Sage',
];
const today = new Date('2026-10-30T00:00:00.000Z');

describe('VALORANT tactical presets', () => {
  it('supports 13 maps and 3 distinct complete examples for each', () => {
    for (const [map] of VALORANT_MAPS) {
      const choices = [0, 1, 2].map((index) => pickTacticalAgents(map, 5, agents, () => index));
      expect(
        choices.every((choice) => choice.status === 'ok'),
        map,
      ).toBe(true);
      const teams = choices.flatMap((choice) => (choice.status === 'ok' ? [choice.agents] : []));
      expect(new Set(teams.map((team) => [...team].sort().join(','))).size, map).toBe(3);
      for (const team of teams) {
        expect(new Set(team).size).toBe(5);
      }
      expect(tacticalMapPlan(map).focus.length).toBeGreaterThan(4);
      expect(choices[0]).toMatchObject({
        status: 'ok',
        basis: 'curated',
        version: VALORANT_COMPOSITION_VERSION,
      });
    }
  });

  it('always prioritizes entry then smoke for 1-4 people without full-team claims', () => {
    const pick = pickTacticalAgents('Ascent', 2, ['Jett', 'Omen'], () => 0);
    expect(pick).toMatchObject({ status: 'ok', agents: ['Jett', 'Omen'] });
    if (pick.status === 'ok') expect(pick.description).toContain('未完成');
    expect(pickTacticalAgents('Haven', 1, ['Jett'], () => 0)).toMatchObject({
      status: 'ok',
      agents: ['Jett'],
      basis: 'curated',
    });
  });

  it('never chooses disabled agents or falls back to a completely random team', () => {
    expect(pickTacticalAgents('Ascent', 5, ['Jett', 'Omen'])).toEqual({ status: 'unavailable' });
    expect(pickTacticalAgents('Ascent', 0, agents)).toEqual({ status: 'unavailable' });
    expect(pickTacticalAgents('Ascent', 6, agents)).toEqual({ status: 'unavailable' });
    expect(() => pickTacticalAgents('Ascent', 5, agents, () => 3)).toThrow(RangeError);
  });
});

describe('VALORANT licensed statistics handling', () => {
  const compositions = [
    ['Jett', 'Omen', 'Sova', 'Killjoy', 'KAY/O'],
    ['Raze', 'Astra', 'Fade', 'Cypher', 'Breach'],
    ['Jett', 'Omen', 'Sova', 'Cypher', 'Gekko'],
  ];
  function samples(): TacticalCompositionEvidence[] {
    return compositions.map((team, index) => ({
      map: 'Ascent',
      agents: team,
      patch: VALORANT_COMPOSITION_PATCH,
      observedAt: '2026-10-29',
      matchesPlayed: [200, 150, 120][index]!,
      matchesWon: [110, 70, 60][index]!,
      mapMatchesPlayed: 1000,
      provenance: 'manually-verified-authorized',
    }));
  }

  it('only uses complete same-patch sample sets and reports their evidence basis', () => {
    const metrics = samples();
    const weights = evidenceWeights('Ascent', compositions, metrics, today);
    expect(weights).not.toBeNull();
    expect(weights).toHaveLength(3);
    expect(weights?.every((weight) => weight > 0 && weight <= 100)).toBe(true);
    expect(pickTacticalAgents('Ascent', 5, agents, () => 0, metrics, today)).toMatchObject({
      status: 'ok',
      basis: 'verified-statistics',
    });
    expect(pickTacticalAgents('Ascent', 2, agents, () => 0, metrics, today)).toMatchObject({
      status: 'ok',
      basis: 'curated',
    });
  });

  it('does not invent a ranking with stale, missing, mismatched or low-sample data', () => {
    const metrics = samples();
    expect(evidenceWeights('Ascent', compositions, metrics.slice(0, 2), today)).toBeNull();
    expect(
      evidenceWeights(
        'Ascent',
        compositions,
        metrics.map((x) => ({ ...x, observedAt: '2026-01-01' })),
        today,
      ),
    ).toBeNull();
    expect(
      evidenceWeights(
        'Ascent',
        compositions,
        metrics.map((x) => ({ ...x, matchesPlayed: 12, matchesWon: 4 })),
        today,
      ),
    ).toBeNull();
    expect(
      evidenceWeights(
        'Ascent',
        compositions,
        metrics.map((x) => ({ ...x, patch: '13.08' })),
        today,
      ),
    ).toBeNull();
    expect(
      evidenceWeights(
        'Ascent',
        compositions,
        metrics.map((x) => ({ ...x, provenance: 'unverified' as never })),
        today,
      ),
    ).toBeNull();
    expect(
      pickTacticalAgents('Ascent', 5, agents, () => 1, metrics.slice(0, 2), today),
    ).toMatchObject({ status: 'ok', basis: 'curated' });
  });

  it('rejects invalid sample counts and unequal map denominators', () => {
    const original = samples();
    const inconsistent = original.map((x, i) => ({
      ...x,
      mapMatchesPlayed: i === 1 ? 900 : 1000,
    }));
    expect(evidenceWeights('Ascent', compositions, inconsistent, today)).toBeNull();
    expect(
      evidenceWeights(
        'Ascent',
        compositions,
        original.map((x) => ({ ...x, matchesWon: x.matchesPlayed + 1 })),
        today,
      ),
    ).toBeNull();
  });
});
