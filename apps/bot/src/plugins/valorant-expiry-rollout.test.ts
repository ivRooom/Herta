import { describe, expect, it } from 'vitest';
import { enabledValorantExpiryGuildIds } from './valorant-expiry-rollout.js';

describe('VALORANT public expiry UI rollout', () => {
  const approved = '123456789012345678';
  const another = '234567890123456789';

  it('is disabled when the toggle is missing or not exactly true', () => {
    expect(enabledValorantExpiryGuildIds(undefined, approved).size).toBe(0);
    expect(enabledValorantExpiryGuildIds('false', approved).size).toBe(0);
    expect(enabledValorantExpiryGuildIds('TRUE', approved).size).toBe(0);
    expect(enabledValorantExpiryGuildIds('1', approved).size).toBe(0);
  });

  it('fails closed for empty or malformed allowlists', () => {
    expect(enabledValorantExpiryGuildIds('true', undefined).size).toBe(0);
    expect(enabledValorantExpiryGuildIds('true', '').size).toBe(0);
    expect(enabledValorantExpiryGuildIds('true', 'abc').size).toBe(0);
    expect(enabledValorantExpiryGuildIds('true', approved + ',invalid').size).toBe(0);
    expect(enabledValorantExpiryGuildIds('true', approved + ',').size).toBe(0);
  });

  it('permits only explicitly listed Guild snowflakes and deduplicates', () => {
    const ids = enabledValorantExpiryGuildIds(
      'true',
      ' ' + approved + ', ' + another + ', ' + approved + ' ',
    );
    expect([...ids]).toEqual([approved, another]);
    expect(ids.has('345678901234567890')).toBe(false);
  });
});
