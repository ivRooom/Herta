import { describe, expect, it } from 'vitest';
import {
  parseValorantSessionAction,
  VALORANT_SESSION_PREFIX,
} from './valorant-session-repository.js';

describe('VALORANT session custom IDs', () => {
  it('rejects malformed or foreign component ids', () => {
    expect(parseValorantSessionAction('herta:giveaway:v1:x:join')).toBeNull();
    expect(parseValorantSessionAction(VALORANT_SESSION_PREFIX + 'invalid:draw')).toBeNull();
    expect(
      parseValorantSessionAction(
        VALORANT_SESSION_PREFIX + 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05:admin',
      ),
    ).toBeNull();
  });
  it('accepts only bounded VC and membership selection custom IDs', () => {
    const prefix = VALORANT_SESSION_PREFIX + 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05:';
    expect(parseValorantSessionAction(prefix + 'manage')?.action).toBe('manage');
    expect(parseValorantSessionAction(prefix + 'vc')?.action).toBe('vc');
    expect(parseValorantSessionAction(prefix + 'vc-commit-123456abcdef')?.action).toBe('vc-commit-123456abcdef');
    expect(parseValorantSessionAction(prefix + 'add-123456789012345678')?.action).toBe('add-123456789012345678');
    expect(parseValorantSessionAction(prefix + 'add-INVALID')).toBeNull();
    expect(parseValorantSessionAction(prefix + 'vc-choose-bad')).toBeNull();
  });
  it('parses strictly scoped join/leave/draw/cancel actions', () => {
    for (const action of ['join', 'leave', 'draw', 'cancel']) {
      expect(
        parseValorantSessionAction(
          VALORANT_SESSION_PREFIX + 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05:' + action,
        )?.action,
      ).toBe(action);
    }
  });
});
