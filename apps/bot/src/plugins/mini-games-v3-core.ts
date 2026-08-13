export type ChinchiroKind =
  | 'pinzoro'
  | 'triple'
  | 'shigoro'
  | 'point'
  | 'no-hand'
  | 'hifumi';

export interface ChinchiroHand {
  dice: readonly [number, number, number];
  kind: ChinchiroKind;
  point: number;
  rank: number;
}

export interface ChinchiroTurn {
  hand: ChinchiroHand;
  rolls: number;
  attempts: readonly ChinchiroHand[];
}

export function rollDice(
  sides = 6,
  count = 1,
  random: () => number = Math.random,
): number[] {
  const safeSides = clamp(sides, 2, 100);
  const safeCount = clamp(count, 1, 10);
  return Array.from({ length: safeCount }, () =>
    Math.floor(Math.max(0, Math.min(0.999999999, random())) * safeSides) + 1,
  );
}

export function evaluateChinchiroHand(
  diceInput: readonly [number, number, number] | readonly number[],
): ChinchiroHand {
  const normalized = [
    clamp(diceInput[0] ?? 1, 1, 6),
    clamp(diceInput[1] ?? 1, 1, 6),
    clamp(diceInput[2] ?? 1, 1, 6),
  ].sort((a, b) => a - b) as [number, number, number];

  const [a, b, c] = normalized;
  if (a === 1 && b === 1 && c === 1)
    return { dice: normalized, kind: 'pinzoro', point: 1, rank: 80 };
  if (a === b && b === c)
    return { dice: normalized, kind: 'triple', point: a, rank: 70 + a };
  if (a === 4 && b === 5 && c === 6)
    return { dice: normalized, kind: 'shigoro', point: 6, rank: 60 };
  if (a === 1 && b === 2 && c === 3)
    return { dice: normalized, kind: 'hifumi', point: 0, rank: 0 };
  if (a === b)
    return { dice: normalized, kind: 'point', point: c, rank: 40 + c };
  if (b === c)
    return { dice: normalized, kind: 'point', point: a, rank: 40 + a };
  return { dice: normalized, kind: 'no-hand', point: 0, rank: 10 };
}

export function compareChinchiroHands(
  player: ChinchiroHand,
  dealer: ChinchiroHand,
): 'player-win' | 'dealer-win' | 'push' {
  if (player.rank === dealer.rank) return 'push';
  return player.rank > dealer.rank ? 'player-win' : 'dealer-win';
}

export function rollChinchiroTurn(
  random: () => number = Math.random,
  maxRolls = 3,
): ChinchiroTurn {
  const attempts: ChinchiroHand[] = [];
  const rolls = clamp(maxRolls, 1, 3);
  for (let index = 0; index < rolls; index += 1) {
    const dice = rollDice(6, 3, random) as [number, number, number];
    const hand = evaluateChinchiroHand(dice);
    attempts.push(hand);
    if (hand.kind !== 'no-hand') return { hand, rolls: index + 1, attempts };
  }
  return { hand: attempts[attempts.length - 1]!, rolls, attempts };
}

export function isChinchiroSpecial(hand: ChinchiroHand): boolean {
  return hand.kind === 'pinzoro' || hand.kind === 'triple' || hand.kind === 'shigoro';
}

export function formatChinchiroHand(hand: ChinchiroHand): string {
  const dice = hand.dice.map((value) => dieFace(value)).join(' ');
  const label =
    hand.kind === 'pinzoro'
      ? 'ピンゾロ'
      : hand.kind === 'triple'
        ? `${hand.point}のゾロ目`
        : hand.kind === 'shigoro'
          ? 'シゴロ'
          : hand.kind === 'hifumi'
            ? 'ヒフミ'
            : hand.kind === 'point'
              ? `${hand.point}の目`
              : '役なし';
  return `${dice} **${label}**`;
}

function dieFace(value: number): string {
  return ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][value - 1] ?? `🎲${value}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
