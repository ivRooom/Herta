/** Manual VALORANT match outcomes must agree with the entered round score. */
export function validValorantOutcomeScore(
  outcome: unknown,
  roundsWon: unknown,
  roundsLost: unknown,
): boolean {
  if (
    typeof roundsWon !== 'number' ||
    typeof roundsLost !== 'number' ||
    !Number.isInteger(roundsWon) ||
    !Number.isInteger(roundsLost) ||
    roundsWon < 0 ||
    roundsLost < 0 ||
    roundsWon > 100 ||
    roundsLost > 100 ||
    roundsWon + roundsLost === 0
  ) {
    return false;
  }
  if (outcome === 'WIN') return roundsWon > roundsLost;
  if (outcome === 'LOSS') return roundsWon < roundsLost;
  if (outcome === 'DRAW') return roundsWon === roundsLost;
  return false;
}

/** A team cannot have the same agent twice in a single recorded match. */
export function uniqueActualValorantAgents(
  players: readonly { agentId: string }[],
): boolean {
  return players.length > 0 && new Set(players.map((person) => person.agentId)).size === players.length;
}
