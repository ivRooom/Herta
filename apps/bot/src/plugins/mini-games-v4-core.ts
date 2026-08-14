export type JankenChoice = 'rock' | 'paper' | 'scissors';
export type JankenRoundResult = 'player-win' | 'dealer-win' | 'draw';

export interface JankenRound {
  player: JankenChoice;
  dealer: JankenChoice;
  result: JankenRoundResult;
}

export interface JankenSeries {
  rounds: JankenRound[];
  playerWins: number;
  dealerWins: number;
  draws: number;
  winner: 'player' | 'dealer' | 'draw';
}

export interface NumberGuessResult {
  guess: number;
  target: number;
  difference: number;
  result: 'hit' | 'near' | 'miss';
  direction: 'exact' | 'higher' | 'lower';
}

const JANKEN_CHOICES: readonly JankenChoice[] = ['rock', 'paper', 'scissors'];

export function randomJankenChoice(random: () => number = Math.random): JankenChoice {
  const index = Math.min(2, Math.max(0, Math.floor(random() * JANKEN_CHOICES.length)));
  return JANKEN_CHOICES[index] ?? 'rock';
}

export function resolveJanken(
  player: JankenChoice,
  dealer: JankenChoice,
): JankenRoundResult {
  if (player === dealer) return 'draw';
  if (
    (player === 'rock' && dealer === 'scissors') ||
    (player === 'paper' && dealer === 'rock') ||
    (player === 'scissors' && dealer === 'paper')
  ) {
    return 'player-win';
  }
  return 'dealer-win';
}

export function playJankenSeries(
  player: JankenChoice,
  bestOf = 1,
  random: () => number = Math.random,
): JankenSeries {
  const safeBestOf = bestOf === 3 || bestOf === 5 ? bestOf : 1;
  const winsNeeded = Math.floor(safeBestOf / 2) + 1;
  const rounds: JankenRound[] = [];
  let playerWins = 0;
  let dealerWins = 0;
  let draws = 0;

  while (playerWins < winsNeeded && dealerWins < winsNeeded && rounds.length < safeBestOf * 3) {
    const dealer = randomJankenChoice(random);
    const result = resolveJanken(player, dealer);
    rounds.push({ player, dealer, result });
    if (result === 'player-win') playerWins += 1;
    else if (result === 'dealer-win') dealerWins += 1;
    else draws += 1;
  }

  return {
    rounds,
    playerWins,
    dealerWins,
    draws,
    winner: playerWins > dealerWins ? 'player' : dealerWins > playerWins ? 'dealer' : 'draw',
  };
}

export function playNumberGuess(
  guess: number,
  random: () => number = Math.random,
): NumberGuessResult {
  const safeGuess = Math.min(100, Math.max(1, Math.trunc(guess)));
  const target = Math.min(100, Math.max(1, Math.floor(random() * 100) + 1));
  const difference = Math.abs(safeGuess - target);
  return {
    guess: safeGuess,
    target,
    difference,
    result: difference === 0 ? 'hit' : difference <= 5 ? 'near' : 'miss',
    direction: difference === 0 ? 'exact' : target > safeGuess ? 'higher' : 'lower',
  };
}

export function jankenChoiceLabel(choice: JankenChoice): string {
  if (choice === 'rock') return '✊ グー';
  if (choice === 'paper') return '✋ パー';
  return '✌️ チョキ';
}
