export type ChinchiroHandKind =
  | 'pinzoro'
  | 'triple'
  | 'shigoro'
  | 'point'
  | 'no-hand'
  | 'hifumi';

export interface ChinchiroHand {
  dice: readonly [number, number, number];
  kind: ChinchiroHandKind;
  point: number | null;
  strength: number;
}

export interface ChinchiroTurn {
  hand: ChinchiroHand;
  rolls: number;
}

export function rollDice(
  sides = 6,
  count = 1,
  random: () => number = Math.random,
): number[] {
  const safeSides = Math.min(100, Math.max(2, Math.trunc(sides)));
  const safeCount = Math.min(10, Math.max(1, Math.trunc(count)));
  return Array.from({ length: safeCount }, () => Math.floor(random() * safeSides) + 1);
}

export function evaluateChinchiroHand(dice: readonly [number, number, number]): ChinchiroHand {
  const sorted = [...dice].sort((a, b) => a - b) as [number, number, number];
  const [a, b, c] = sorted;
  if (a === 1 && b === 1 && c === 1) return { dice, kind: 'pinzoro', point: null, strength: 700 };
  if (a === b && b === c) return { dice, kind: 'triple', point: a, strength: 600 + a };
  if (a === 4 && b === 5 && c === 6) return { dice, kind: 'shigoro', point: null, strength: 500 };
  if (a === 1 && b === 2 && c === 3) return { dice, kind: 'hifumi', point: null, strength: 0 };
  const point = pairPoint(sorted);
  if (point !== null) return { dice, kind: 'point', point, strength: 100 + point };
  return { dice, kind: 'no-hand', point: null, strength: 50 };
}

export function rollChinchiroTurn(
  random: () => number = Math.random,
  maxRolls = 3,
): ChinchiroTurn {
  const safeRolls = Math.min(3, Math.max(1, Math.trunc(maxRolls)));
  let hand = evaluateChinchiroHand(asThreeDice(rollDice(6, 3, random)));
  let rolls = 1;
  while (hand.kind === 'no-hand' && rolls < safeRolls) {
    hand = evaluateChinchiroHand(asThreeDice(rollDice(6, 3, random)));
    rolls += 1;
  }
  return { hand, rolls };
}

export function compareChinchiroHands(
  player: ChinchiroHand,
  dealer: ChinchiroHand,
): 'player-win' | 'dealer-win' | 'push' {
  if (player.strength > dealer.strength) return 'player-win';
  if (player.strength < dealer.strength) return 'dealer-win';
  return 'push';
}

export function formatChinchiroHand(hand: ChinchiroHand): string {
  const dice = hand.dice.map((value) => dieFace(value)).join(' ');
  const label =
    hand.kind === 'pinzoro'
      ? 'ピンゾロ'
      : hand.kind === 'triple'
        ? `ゾロ目 ${hand.point}`
        : hand.kind === 'shigoro'
          ? 'シゴロ'
          : hand.kind === 'hifumi'
            ? 'ヒフミ'
            : hand.kind === 'point'
              ? `${hand.point}の目`
              : '役なし';
  return `${dice} — **${label}**`;
}

export function isChinchiroSpecial(hand: ChinchiroHand): boolean {
  return hand.kind === 'pinzoro' || hand.kind === 'triple' || hand.kind === 'shigoro';
}

function pairPoint(sorted: readonly [number, number, number]): number | null {
  const [a, b, c] = sorted;
  if (a === b) return c;
  if (b === c) return a;
  if (a === c) return b;
  return null;
}

function asThreeDice(values: readonly number[]): [number, number, number] {
  return [values[0] ?? 1, values[1] ?? 1, values[2] ?? 1];
}

function dieFace(value: number): string {
  return ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][value - 1] ?? `🎲${value}`;
}
