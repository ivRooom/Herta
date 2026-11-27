import { describe, expect, it } from 'vitest';
import {
  canWerewolfTransition,
  decideWerewolfRound,
  isValidWerewolfRoster,
  judgeWerewolfOutcome,
  leadingWerewolfCandidates,
  pickRandomUserId,
  selectWerewolfUserId,
  tallyWerewolfVotes,
  trailingWerewolfCandidates,
  werewolfPunishmentCandidates,
  WEREWOLF_SECRET_CATEGORIES,
  type WerewolfRosterEntry,
} from './valorant-werewolf-core.js';

const ROSTER: WerewolfRosterEntry[] = [
  { userId: 'alice', displayName: 'Alice' },
  { userId: 'bob', displayName: 'Bob' },
  { userId: 'carol', displayName: 'Carol' },
  { userId: 'dave', displayName: 'Dave' },
];
const ORDER = ROSTER.map((entry) => entry.userId);

function tallyOf(counts: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(counts));
}

describe('tallyWerewolfVotes', () => {
  it('counts per candidate and keeps zero-vote candidates', () => {
    const tally = tallyWerewolfVotes(
      [
        { voterUserId: 'bob', targetUserId: 'alice' },
        { voterUserId: 'carol', targetUserId: 'alice' },
        { voterUserId: 'alice', targetUserId: 'bob' },
      ],
      ORDER,
    );
    expect(tally.get('alice')).toBe(2);
    expect(tally.get('bob')).toBe(1);
    expect(tally.get('carol')).toBe(0);
    expect(tally.get('dave')).toBe(0);
  });

  it('ignores votes for non-candidates', () => {
    const tally = tallyWerewolfVotes([{ voterUserId: 'alice', targetUserId: 'mallory' }], ORDER);
    expect(tally.has('mallory')).toBe(false);
    expect([...tally.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('leading / trailing candidates', () => {
  it('returns tied leaders in roster order', () => {
    const tally = tallyOf({ alice: 2, bob: 2, carol: 1, dave: 0 });
    expect(leadingWerewolfCandidates(tally, ORDER)).toEqual(['alice', 'bob']);
  });

  it('returns a single leader', () => {
    const tally = tallyOf({ alice: 1, bob: 3, carol: 0, dave: 0 });
    expect(leadingWerewolfCandidates(tally, ORDER)).toEqual(['bob']);
  });

  it('includes zero-vote members among the trailing candidates', () => {
    const tally = tallyOf({ alice: 2, bob: 1, carol: 0, dave: 0 });
    expect(trailingWerewolfCandidates(tally, ORDER)).toEqual(['carol', 'dave']);
  });
});

describe('decideWerewolfRound', () => {
  it('accuses a single leader', () => {
    expect(decideWerewolfRound(tallyOf({ alice: 1, bob: 3, carol: 0, dave: 0 }), ORDER, 1)).toEqual(
      { kind: 'accused', accusedUserId: 'bob' },
    );
  });

  it('sends a first-round tie to a runoff with only the tied leaders', () => {
    expect(decideWerewolfRound(tallyOf({ alice: 2, bob: 2, carol: 0, dave: 0 }), ORDER, 1)).toEqual(
      { kind: 'runoff', candidateUserIds: ['alice', 'bob'] },
    );
  });

  it('ends a final-round tie without an accused', () => {
    expect(decideWerewolfRound(tallyOf({ alice: 2, bob: 2 }), ['alice', 'bob'], 2)).toEqual({
      kind: 'final_tie',
    });
  });

  it('treats a voteless first round as no_votes and a voteless runoff as a final tie', () => {
    expect(
      decideWerewolfRound(tallyOf({ alice: 0, bob: 0, carol: 0 }), ORDER.slice(0, 3), 1),
    ).toEqual({ kind: 'no_votes' });
    expect(decideWerewolfRound(tallyOf({ alice: 0, bob: 0 }), ['alice', 'bob'], 2)).toEqual({
      kind: 'final_tie',
    });
  });
});

describe('judgeWerewolfOutcome', () => {
  it('citizens win when the accused is the werewolf', () => {
    expect(judgeWerewolfOutcome('bob', 'bob')).toEqual({
      outcome: 'CITIZENS_WIN',
      reason: 'ACCUSED_FOUND',
    });
  });

  it('werewolf wins when the accused is a citizen or nobody is accused', () => {
    expect(judgeWerewolfOutcome('alice', 'bob')).toEqual({
      outcome: 'WEREWOLF_WIN',
      reason: 'ACCUSED_MISSED',
    });
    expect(judgeWerewolfOutcome(null, 'bob')).toEqual({
      outcome: 'WEREWOLF_WIN',
      reason: 'FINAL_TIE',
    });
  });
});

describe('werewolfPunishmentCandidates', () => {
  it('uses the first-round fewest votes, including zero-vote members', () => {
    const firstRound = tallyOf({ alice: 3, bob: 1, carol: 0, dave: 2 });
    expect(werewolfPunishmentCandidates(firstRound, ORDER)).toEqual(['carol']);
  });

  it('returns every tied fewest-vote member for the random pick', () => {
    const firstRound = tallyOf({ alice: 2, bob: 0, carol: 0, dave: 1 });
    expect(werewolfPunishmentCandidates(firstRound, ORDER)).toEqual(['bob', 'carol']);
  });

  it('has no target when the first round had no votes at all', () => {
    expect(werewolfPunishmentCandidates(tallyOf({ alice: 0, bob: 0 }), ['alice', 'bob'])).toEqual(
      [],
    );
  });
});

describe('random selection', () => {
  it('selects the werewolf by injected random index and never leaves the roster', () => {
    expect(selectWerewolfUserId(ROSTER, () => 0)).toBe('alice');
    expect(selectWerewolfUserId(ROSTER, (max) => max - 1)).toBe('dave');
    expect(selectWerewolfUserId([], () => 0)).toBeNull();
  });

  it('picks a punishment target from the tied candidates', () => {
    expect(pickRandomUserId(['bob', 'carol'], () => 1)).toBe('carol');
    expect(pickRandomUserId([], () => 0)).toBeNull();
  });

  it('default crypto random stays inside the roster', () => {
    for (let i = 0; i < 50; i++) {
      expect(ORDER).toContain(selectWerewolfUserId(ROSTER));
    }
  });
});

describe('transition guards and roster validation', () => {
  it('rejects operations from the wrong phase', () => {
    expect(canWerewolfTransition('PLAYING', 'open_vote')).toBe(true);
    expect(canWerewolfTransition('VOTING', 'open_vote')).toBe(false);
    expect(canWerewolfTransition('VOTING', 'cast_vote')).toBe(true);
    expect(canWerewolfTransition('RUNOFF', 'close_round')).toBe(true);
    expect(canWerewolfTransition('RESOLVED', 'abort')).toBe(false);
    expect(canWerewolfTransition('ASSIGNING', 'confirm_assignment')).toBe(true);
    expect(canWerewolfTransition('PLAYING', 'confirm_assignment')).toBe(false);
  });

  it('requires 3-5 unique members to start', () => {
    expect(isValidWerewolfRoster(ROSTER.slice(0, 2))).toBe(false);
    expect(isValidWerewolfRoster(ROSTER.slice(0, 3))).toBe(true);
    expect(isValidWerewolfRoster(ROSTER)).toBe(true);
    expect(
      isValidWerewolfRoster([...ROSTER, { userId: 'erin', displayName: 'Erin' }, ROSTER[0]!]),
    ).toBe(false);
  });

  it('keeps punishment out of the secret categories', () => {
    expect(WEREWOLF_SECRET_CATEGORIES).toEqual(['troll', 'settings', 'custom']);
    expect(WEREWOLF_SECRET_CATEGORIES).not.toContain('punishment');
  });
});
