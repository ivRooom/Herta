import { randomInt } from 'node:crypto';

export type ChinchiroKind = 'shigoro' | 'hifumi' | 'triple' | 'point' | 'no-hand';

export interface ChinchiroResult {
  dice: [number, number, number];
  kind: ChinchiroKind;
  point?: number;
}

export interface ChinchiroTurn {
  attempts: ChinchiroResult[];
  result: ChinchiroResult;
}

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'] as const;

export function rollDice(
  count: number,
  sides: number,
  random: (max: number) => number = randomInt,
): number[] {
  const safeCount = clampInteger(count, 1, 10);
  const safeSides = clampInteger(sides, 2, 100);
  return Array.from({ length: safeCount }, () => random(safeSides) + 1);
}

export function evaluateChinchiro(values: readonly number[]): ChinchiroResult {
  if (values.length !== 3 || values.some((value) => !Number.isInteger(value) || value < 1 || value > 6)) {
    throw new Error('チンチロは1〜6のサイコロ3個で判定します');
  }

  const dice = [...values].sort((a, b) => a - b) as [number, number, number];
  const [first, second, third] = dice;

  if (first === 4 && second === 5 && third === 6) return { dice, kind: 'shigoro' };
  if (first === 1 && second === 2 && third === 3) return { dice, kind: 'hifumi' };
  if (first === second && second === third) return { dice, kind: 'triple', point: first };
  if (first === second) return { dice, kind: 'point', point: third };
  if (second === third) return { dice, kind: 'point', point: first };
  return { dice, kind: 'no-hand' };
}

export function playChinchiroTurn(
  maxAttempts = 3,
  random: (max: number) => number = randomInt,
): ChinchiroTurn {
  const attempts: ChinchiroResult[] = [];
  const safeAttempts = clampInteger(maxAttempts, 1, 3);

  for (let index = 0; index < safeAttempts; index += 1) {
    const result = evaluateChinchiro(rollDice(3, 6, random));
    attempts.push(result);
    if (result.kind !== 'no-hand') return { attempts, result };
  }

  return { attempts, result: attempts.at(-1)! };
}

export function formatDiceRoll(values: readonly number[], sides: number): string {
  const faces = values
    .map((value) => (sides === 6 ? DICE_FACES[value - 1] : undefined) ?? `**${value}**`)
    .join(' ');
  const total = values.reduce((sum, value) => sum + value, 0);
  return [`🎲 **Dice · ${values.length}d${sides}**`, faces, `合計: **${total.toLocaleString()}**`].join(
    '\n',
  );
}

export function formatChinchiroTurn(turn: ChinchiroTurn): string {
  const lines = ['🎲 **チンチロ**'];
  for (const [index, attempt] of turn.attempts.entries()) {
    lines.push(`${index + 1}投目: ${formatDiceFaces(attempt.dice)} — ${chinchiroLabel(attempt)}`);
  }
  lines.push('', `結果: **${chinchiroResultLabel(turn.result)}**`);
  return lines.join('\n');
}

export function chinchiroResultLabel(result: ChinchiroResult): string {
  switch (result.kind) {
    case 'shigoro':
      return '🎉 シゴロ（4-5-6）';
    case 'hifumi':
      return '💥 ヒフミ（1-2-3）';
    case 'triple':
      return `✨ ${result.point}ゾロ`;
    case 'point':
      return `🎯 ${result.point}の目`;
    default:
      return '➖ 役なし';
  }
}

function chinchiroLabel(result: ChinchiroResult): string {
  switch (result.kind) {
    case 'shigoro':
      return 'シゴロ';
    case 'hifumi':
      return 'ヒフミ';
    case 'triple':
      return `${result.point}ゾロ`;
    case 'point':
      return `${result.point}の目`;
    default:
      return '役なし';
  }
}

function formatDiceFaces(values: readonly number[]): string {
  return values.map((value) => DICE_FACES[value - 1] ?? String(value)).join(' ');
}

function clampInteger(value: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(max, Math.max(min, integer));
}
