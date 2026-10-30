import { describe, expect, it } from 'vitest';
import { pickTacticalAgents, VALORANT_MAPS } from './valorant-maps.js';

describe('VALORANT tactical templates', () => {
  it('supports all maps with two complete distinct examples', () => {
    for (const [map] of VALORANT_MAPS) {
      const available = [
        'Jett', 'Raze', 'Yoru', 'Neon', 'Omen', 'Astra', 'Brimstone', 'Viper', 'Harbor',
        'Sova', 'Fade', 'Gekko', 'Skye', 'KAY/O', 'Breach', 'Killjoy', 'Cypher', 'Sage',
      ];
      const first = pickTacticalAgents(map, 5, available, () => 0);
      const second = pickTacticalAgents(map, 5, available, (max) => max - 1);
      expect(first.status).toBe('ok');
      expect(second.status).toBe('ok');
      if (first.status !== 'ok' || second.status !== 'ok') continue;
      expect(new Set(first.agents).size).toBe(5);
      expect(first.agents).not.toEqual(second.agents);
    }
  });
  it('prioritizes entry/smoke for small parties without repeating agents', () => {
    const pick = pickTacticalAgents('Ascent', 2, ['Jett', 'Omen'], () => 0);
    expect(pick.status).toBe('ok');
    if (pick.status === 'ok') expect(pick.agents).toEqual(['Jett', 'Omen']);
  });
  it('fails closed when the guild disables required agents', () => {
    expect(pickTacticalAgents('Ascent', 5, ['Jett', 'Omen'])).toEqual({ status: 'unavailable' });
    expect(pickTacticalAgents('Ascent', 0, ['Jett', 'Omen'])).toEqual({ status: 'unavailable' });
  });
});
