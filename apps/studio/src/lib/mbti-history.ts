export const HISTORY_AXES = ['EI', 'SN', 'TF', 'JP', 'AT'] as const;
export function mbtiHistorySourceLabel(source: string, questionCount: number) {
  if (source === 'estimate') return '過去結果からの推定（実測ではありません）';
  if (source === 'correction') return '手動訂正（診断スコアなし）';
  if (source === 'web' || source === 'discord') {
    return `${questionCount}問 · ${source === 'web' ? 'Web' : 'Discord'}`;
  }
  return '保存済みの結果';
}
export const HISTORY_AXIS_LABELS = {
  EI: ['外向 E', '内向 I'],
  SN: ['現実 S', '直感 N'],
  TF: ['思考 T', '感情 F'],
  JP: ['計画 J', '柔軟 P'],
  AT: ['自己確信 A', '慎重 T'],
} as const;

export function readMbtiHistoryPercentages(value: unknown): Record<string, number> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const axis of HISTORY_AXES) {
    const n = source[axis];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) return null;
    result[axis] = n;
  }
  return result;
}

export function compareMbtiHistory(
  current: { percentages: unknown; scoringVersion: string },
  previous: { percentages: unknown; scoringVersion: string },
) {
  if ([current.scoringVersion, previous.scoringVersion].includes('historical-estimate-v1'))
    return null;
  const a = readMbtiHistoryPercentages(current.percentages);
  const b = readMbtiHistoryPercentages(previous.percentages);
  if (!a || !b || current.scoringVersion !== previous.scoringVersion) return null;
  return HISTORY_AXES.map((axis) => ({
    axis,
    current: a[axis]!,
    previous: b[axis]!,
    delta: a[axis]! - b[axis]!,
    crossed: a[axis]! >= 50 !== b[axis]! >= 50,
  }));
}
