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
