import { createHash, createHmac } from 'node:crypto';
import type { TeamSplitMode } from './config.js';

export interface TeamSplitMember {
  userId: string;
  score: number;
}

export interface TeamSplitTeam {
  teamNumber: number;
  members: TeamSplitMember[];
  totalScore: number;
}

export function deriveTeamSplitSeedHash(
  secret: string,
  guildId: string,
  sessionId: string,
  requestedSeed: string,
): string {
  if (secret.length < 32) throw new Error('TEAM_SPLIT_SECRETは32文字以上で設定してください');
  return createHmac('sha256', secret)
    .update(`${guildId}:${sessionId}:${requestedSeed}`)
    .digest('hex');
}

export function splitTeamMembers(
  members: TeamSplitMember[],
  teamCount: number,
  mode: TeamSplitMode,
  seedHash: string,
  generation: number,
): TeamSplitTeam[] {
  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new Error('teamCountは2以上の整数で指定してください');
  }
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error('generationは0以上の整数で指定してください');
  }
  if (members.length < teamCount) {
    throw new Error('参加者数はteamCount以上必要です');
  }

  const unique = new Set(members.map((member) => member.userId));
  if (unique.size !== members.length) throw new Error('参加者が重複しています');

  const teams = Array.from({ length: teamCount }, (_, index) => ({
    teamNumber: index + 1,
    members: [] as TeamSplitMember[],
    totalScore: 0,
  }));

  if (mode === 'random') {
    const ordered = [...members].sort((left, right) =>
      deterministicKey(seedHash, generation, left.userId).localeCompare(
        deterministicKey(seedHash, generation, right.userId),
      ),
    );
    ordered.forEach((member, index) => assignMember(teams[index % teamCount]!, member));
    return teams;
  }

  const ordered = [...members].sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (scoreDifference !== 0) return scoreDifference;
    return deterministicKey(seedHash, generation, left.userId).localeCompare(
      deterministicKey(seedHash, generation, right.userId),
    );
  });

  ordered.forEach((member, index) => {
    const round = Math.floor(index / teamCount);
    const offset = index % teamCount;
    const teamIndex = round % 2 === 0 ? offset : teamCount - 1 - offset;
    assignMember(teams[teamIndex]!, member);
  });
  return teams;
}

export function createTeamSplitMessageNonce(sessionId: string, version: number): string {
  return createHash('sha256')
    .update(`team-split:${sessionId}:${version}`)
    .digest('hex')
    .slice(0, 25);
}

function deterministicKey(seedHash: string, generation: number, userId: string): string {
  return createHmac('sha256', seedHash).update(`${generation}:${userId}`).digest('hex');
}

function assignMember(team: TeamSplitTeam, member: TeamSplitMember): void {
  team.members.push(member);
  team.totalScore += member.score;
}
