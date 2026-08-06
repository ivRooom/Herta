import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamSplitSessionRecord } from '@herta/plugin-catalog/team-split-service';
import { toPublicTeamSplitSession } from './team-split.ts';

function createSession(): TeamSplitSessionRecord {
  const now = new Date('2026-07-29T00:00:00.000Z');
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    guildId: 'guild-1',
    creatorId: 'user-1',
    channelId: '123456789012345678',
    messageId: null,
    title: 'Team Split',
    teamCount: 2,
    mode: 'random',
    maxParticipants: 8,
    participantCount: 1,
    participants: ['user-1'],
    teams: null,
    seedHash: 'internal-secret-seed-hash',
    generation: 0,
    status: 'open',
    expiresAt: new Date('2026-07-29T01:00:00.000Z'),
    splitAt: null,
    closedAt: null,
    messageState: 'pending',
    lastErrorName: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

test('Team Split公開レスポンスから内部seed hashを除外する', () => {
  const result = toPublicTeamSplitSession(createSession());
  assert.equal('seedHash' in result, false);
  assert.equal(JSON.stringify(result).includes('internal-secret-seed-hash'), false);
});
