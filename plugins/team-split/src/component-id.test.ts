import { describe, expect, it } from 'vitest';
import { createTeamSplitComponentId, parseTeamSplitComponentId } from './component-id.js';

const SECRET = 'team-split-secret-for-tests-0123456789';
const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const EXPIRES_AT = new Date('2026-07-29T02:00:00.000Z');
const NOW = new Date('2026-07-29T01:00:00.000Z');

describe('Team Split component ID', () => {
  it('署名付きIDを往復できる', () => {
    const customId = createTeamSplitComponentId('join', SESSION_ID, EXPIRES_AT, SECRET);
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseTeamSplitComponentId(customId, SECRET, NOW)).toMatchObject({
      action: 'join',
      sessionId: SESSION_ID,
    });
  });

  it('action・session ID・署名の改ざんを拒否する', () => {
    const customId = createTeamSplitComponentId('join', SESSION_ID, EXPIRES_AT, SECRET);
    expect(parseTeamSplitComponentId(customId.replace(':join:', ':leave:'), SECRET, NOW)).toBeNull();
    expect(parseTeamSplitComponentId(customId.replace('123e4567', '223e4567'), SECRET, NOW)).toBeNull();
    expect(parseTeamSplitComponentId(`${customId.slice(0, -1)}x`, SECRET, NOW)).toBeNull();
  });

  it('期限切れIDを拒否する', () => {
    const customId = createTeamSplitComponentId('leave', SESSION_ID, EXPIRES_AT, SECRET);
    expect(
      parseTeamSplitComponentId(customId, SECRET, new Date('2026-07-29T02:00:01.000Z')),
    ).toBeNull();
  });
});
