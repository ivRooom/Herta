import { describe, expect, it } from 'vitest';
import {
  createTeamSplitMessageNonce,
  deriveTeamSplitSeedHash,
  splitTeamMembers,
  type TeamSplitMember,
} from './split.js';

const SECRET = 'team-split-secret-for-tests-0123456789';
const MEMBERS: TeamSplitMember[] = [
  { userId: '1', score: 100 },
  { userId: '2', score: 90 },
  { userId: '3', score: 80 },
  { userId: '4', score: 70 },
  { userId: '5', score: 60 },
  { userId: '6', score: 50 },
];

const SEED_HASH = deriveTeamSplitSeedHash(
  SECRET,
  '123456789012345678',
  '123e4567-e89b-42d3-a456-426614174000',
  'round-1',
);

describe('splitTeamMembers', () => {
  it('randomモードは同じseedとgenerationで再現できる', () => {
    const first = splitTeamMembers(MEMBERS, 2, 'random', SEED_HASH, 0);
    const second = splitTeamMembers(MEMBERS, 2, 'random', SEED_HASH, 0);
    expect(second).toEqual(first);
    expect(first.flatMap((team) => team.members)).toHaveLength(MEMBERS.length);
  });

  it('reroll generationで並びを変更する', () => {
    const first = splitTeamMembers(MEMBERS, 2, 'random', SEED_HASH, 0);
    const rerolled = splitTeamMembers(MEMBERS, 2, 'random', SEED_HASH, 1);
    expect(rerolled).not.toEqual(first);
  });

  it('balancedモードは明示scoreだけで蛇行配置する', () => {
    const teams = splitTeamMembers(MEMBERS, 2, 'balanced', SEED_HASH, 0);
    expect(teams.map((team) => team.members.length)).toEqual([3, 3]);
    expect(Math.abs(teams[0]!.totalScore - teams[1]!.totalScore)).toBeLessThanOrEqual(10);
  });

  it('重複参加者を拒否する', () => {
    expect(() =>
      splitTeamMembers([...MEMBERS, { userId: '1', score: 0 }], 2, 'random', SEED_HASH, 0),
    ).toThrow('参加者が重複しています');
  });
});

describe('createTeamSplitMessageNonce', () => {
  it('同じversionでは安定し、versionごとに変わる', () => {
    const first = createTeamSplitMessageNonce('session-1', 1);
    expect(createTeamSplitMessageNonce('session-1', 1)).toBe(first);
    expect(createTeamSplitMessageNonce('session-1', 2)).not.toBe(first);
    expect(first).toHaveLength(25);
  });
});
