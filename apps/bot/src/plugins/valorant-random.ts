import { randomInt } from 'node:crypto';

export interface ValorantRandomAssignment {
  userId: string;
  agent: string;
}

export type ValorantRandomResult =
  | { status: 'ok'; assignments: ValorantRandomAssignment[] }
  | { status: 'no_participants' }
  | { status: 'not_enough_agents'; required: number; available: number };

/**
 * Fisher–YatesでAgentを均等に並び替え、ユーザーへ重複なしで割り当てる。
 * participantIdsの重複を除去して入力順を安定化する。乱数は毎回暗号学的PRNGから取得。
 */
export function pickRandomValorantAgents(
  participantIds: readonly string[],
  agents: readonly string[],
  randomIndex: (maxExclusive: number) => number = randomInt,
): ValorantRandomResult {
  const participants = [...new Set(participantIds)].sort();
  if (participants.length === 0) return { status: 'no_participants' };

  const candidates = [...new Set(agents)];
  if (candidates.length < participants.length) {
    return {
      status: 'not_enough_agents',
      required: participants.length,
      available: candidates.length,
    };
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) {
      throw new RangeError('randomIndex must return an integer in [0, maxExclusive)');
    }
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }

  return {
    status: 'ok',
    assignments: participants.map((userId, index) => ({
      userId,
      agent: candidates[index]!,
    })),
  };
}
