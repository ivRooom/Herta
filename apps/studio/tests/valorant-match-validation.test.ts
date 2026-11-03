import { describe, expect, it } from 'vitest';
import {
  uniqueActualValorantAgents,
  validValorantOutcomeScore,
} from '../src/lib/valorant-match-validation';

describe('VALORANT manual match submission', () => {
  it('requires outcome to agree with round score', () => {
    expect(validValorantOutcomeScore('WIN', 13, 8)).toBe(true);
    expect(validValorantOutcomeScore('LOSS', 8, 13)).toBe(true);
    expect(validValorantOutcomeScore('DRAW', 14, 14)).toBe(true);
    expect(validValorantOutcomeScore('WIN', 8, 13)).toBe(false);
    expect(validValorantOutcomeScore('LOSS', 13, 8)).toBe(false);
    expect(validValorantOutcomeScore('DRAW', 13, 8)).toBe(false);
    expect(validValorantOutcomeScore('DRAW', 0, 0)).toBe(false);
    expect(validValorantOutcomeScore('WIN', NaN, 1)).toBe(false);
    expect(validValorantOutcomeScore('WIN', 101, 1)).toBe(false);
    expect(validValorantOutcomeScore('WIN', 3.5, 1)).toBe(false);
    expect(validValorantOutcomeScore('INVALID', 13, 8)).toBe(false);
  });

  it('denies duplicate actual agents for one team', () => {
    expect(uniqueActualValorantAgents([{ agentId: 'jett' }, { agentId: 'omen' }])).toBe(true);
    expect(uniqueActualValorantAgents([{ agentId: 'jett' }, { agentId: 'jett' }])).toBe(false);
    expect(uniqueActualValorantAgents([])).toBe(false);
  });
});
