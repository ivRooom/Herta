import { describe, expect, it } from 'vitest';
import type { ValorantWerewolfGame } from '@herta/db';
import type { ValorantTroll } from './valorant-troll-gacha.js';
import {
  buildWerewolfPersonalView,
  buildWerewolfPublicView,
  type WerewolfSessionLike,
} from './valorant-werewolf-api.js';

const CANARY_TROLL: ValorantTroll = {
  itemId: 'troll-item-canary',
  text: 'SECRET_TROLL_CANARY_TEXT',
  rarity: 'rare',
  category: 'settings',
};
const WEREWOLF_ID = '222222222222222222';

const SESSION: WerewolfSessionLike = {
  id: 'session-1',
  guildId: '964326043420872704',
  channelId: '555555555555555555',
  creatorId: '111111111111111111',
  status: 'IN_PROGRESS',
  maxParticipants: 5,
  expiresAt: new Date('2026-11-27T12:00:00.000Z'),
  participants: [
    { userId: '111111111111111111' },
    { userId: WEREWOLF_ID },
    { userId: '333333333333333333' },
  ],
};

function gameFixture(overrides: Partial<ValorantWerewolfGame> = {}): ValorantWerewolfGame {
  const now = new Date('2026-11-27T11:00:00.000Z');
  return {
    sessionId: SESSION.id,
    phase: 'PLAYING',
    rosterSnapshot: [
      { userId: '111111111111111111', displayName: 'Alice' },
      { userId: WEREWOLF_ID, displayName: 'Bob' },
      { userId: '333333333333333333', displayName: 'Carol' },
    ],
    currentRound: 0,
    currentCandidateUserIds: [],
    roundHistory: [],
    firstRoundTally: null,
    voteEndsAt: null,
    assignmentStatus: 'READY',
    assignmentErrorCode: null,
    outcome: null,
    outcomeReason: null,
    accusedUserId: null,
    punishmentUserId: null,
    punishmentStatus: 'NONE',
    punishmentDrawId: null,
    punishmentItemId: null,
    punishmentText: null,
    punishmentRarity: null,
    punishmentCategory: null,
    revealedTrollItemId: null,
    revealedTrollText: null,
    revealedTrollRarity: null,
    revealedTrollCategory: null,
    startedAt: now,
    resolvedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ValorantWerewolfGame;
}

describe('buildWerewolfPublicView secrecy (#1049)', () => {
  it('shows RECRUITING with the live roster before the game starts', () => {
    const view = buildWerewolfPublicView(SESSION, null);
    expect(view.phase).toBe('RECRUITING');
    expect(view.roster.map((entry) => entry.userId)).toEqual([
      '111111111111111111',
      WEREWOLF_ID,
      '333333333333333333',
    ]);
    expect(view.result).toBeNull();
  });

  it('never contains the werewolf id or the secret troll while playing, even if revealed is passed', () => {
    const view = buildWerewolfPublicView(SESSION, gameFixture(), {
      votedCount: 2,
      revealed: { werewolfUserId: WEREWOLF_ID, troll: CANARY_TROLL },
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('SECRET_TROLL_CANARY_TEXT');
    expect(view.result).toBeNull();
    expect(view.votedCount).toBe(2);
  });

  it('exposes the result only after resolution, with per-round tallies and the punishment', () => {
    const game = gameFixture({
      phase: 'RESOLVED',
      outcome: 'CITIZENS_WIN',
      outcomeReason: 'ACCUSED_FOUND',
      accusedUserId: WEREWOLF_ID,
      currentRound: 1,
      roundHistory: [
        {
          round: 1,
          candidateUserIds: ['111111111111111111', WEREWOLF_ID, '333333333333333333'],
          tally: { '111111111111111111': 0, [WEREWOLF_ID]: 2, '333333333333333333': 1 },
          votedCount: 3,
          rosterSize: 3,
          closeReason: 'all_voted',
        },
      ],
      punishmentUserId: '111111111111111111',
      punishmentStatus: 'READY',
      punishmentItemId: 'troll-item-p',
      punishmentText: '罰ゲーム文',
      punishmentRarity: 'normal',
      punishmentCategory: 'punishment',
    });
    const view = buildWerewolfPublicView(SESSION, game, {
      revealed: { werewolfUserId: WEREWOLF_ID, troll: CANARY_TROLL },
    });
    expect(view.result?.werewolfUserId).toBe(WEREWOLF_ID);
    expect(view.result?.revealedTroll?.text).toBe('SECRET_TROLL_CANARY_TEXT');
    expect(view.result?.rounds).toHaveLength(1);
    expect(view.result?.punishment?.userId).toBe('111111111111111111');
  });
});

describe('buildWerewolfPersonalView secrecy (#1049)', () => {
  const publicView = buildWerewolfPublicView(SESSION, gameFixture());

  it('gives the secret troll only to the werewolf themself', () => {
    const view = buildWerewolfPersonalView(publicView, {
      viewerUserId: WEREWOLF_ID,
      secret: { kind: 'werewolf', troll: CANARY_TROLL },
      ownVoteTargetUserId: '111111111111111111',
    });
    expect(view.viewer.isWerewolf).toBe(true);
    expect(view.viewer.secretTroll?.text).toBe('SECRET_TROLL_CANARY_TEXT');
    expect(view.viewer.ownVoteTargetUserId).toBe('111111111111111111');
  });

  it('gives citizens no secret and only their own vote', () => {
    const view = buildWerewolfPersonalView(publicView, {
      viewerUserId: '333333333333333333',
      secret: { kind: 'citizen' },
      ownVoteTargetUserId: WEREWOLF_ID,
    });
    expect(view.viewer.isWerewolf).toBe(false);
    expect(view.viewer.secretTroll).toBeNull();
    expect(JSON.stringify(view)).not.toContain('SECRET_TROLL_CANARY_TEXT');
  });

  it('reveals nothing to non-participants', () => {
    const view = buildWerewolfPersonalView(publicView, {
      viewerUserId: '999999999999999999',
      secret: { kind: 'not_participant' },
      ownVoteTargetUserId: WEREWOLF_ID,
    });
    expect(view.viewer.isParticipant).toBe(false);
    expect(view.viewer.isWerewolf).toBeNull();
    expect(view.viewer.secretTroll).toBeNull();
    expect(view.viewer.ownVoteTargetUserId).toBeNull();
  });
});
