import type { PrismaClient } from '@herta/db';
import {
  normalizeModerationConfig,
  type ModerationDetectionKind,
} from '@herta/plugin-catalog/moderation-service';

export type ModerationWordRuleKind = Extract<
  ModerationDetectionKind,
  'word_exact' | 'word_contains' | 'word_regex'
>;

export interface ModerationWordRuleGroup {
  kind: ModerationWordRuleKind;
  label: string;
  description: string;
  values: string[];
}

export interface ModerationDetectionRuleReference {
  id: string;
  detectionKind: ModerationDetectionKind;
  ruleIndex: number | null;
  occurredAt: Date;
}

interface ModerationConfigHistoryRow {
  createdAt: Date;
  config: unknown;
}

export type ModerationDetectionRuleHistoryClient = Pick<
  PrismaClient,
  'guildPluginConfigHistory'
>;

const WORD_RULE_META: Array<{
  kind: ModerationWordRuleKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'word_contains',
    label: '部分一致',
    description: '通常のNGワード向け。メッセージ内に含まれると検知します。',
  },
  {
    kind: 'word_exact',
    label: '完全一致',
    description: '正規化後のメッセージ全文が一致した場合だけ検知します。',
  },
  {
    kind: 'word_regex',
    label: '正規表現',
    description: '高度なパターン検知向けの制限付き正規表現です。',
  },
];

export function listCurrentModerationWordRuleGroups(config: unknown): ModerationWordRuleGroup[] {
  const normalized = normalizeModerationConfig(config);
  return WORD_RULE_META.map((meta) => ({
    ...meta,
    values: ruleValues(normalized, meta.kind),
  }));
}

export async function resolveModerationDetectionRuleSnapshots(
  client: ModerationDetectionRuleHistoryClient,
  guildId: string,
  detections: readonly ModerationDetectionRuleReference[],
): Promise<Map<string, string>> {
  const candidates = detections.filter(
    (detection) =>
      isWordRuleKind(detection.detectionKind) &&
      detection.ruleIndex !== null &&
      Number.isSafeInteger(detection.ruleIndex) &&
      detection.ruleIndex >= 0,
  );
  if (candidates.length === 0) return new Map();

  const latestOccurredAt = new Date(
    Math.max(...candidates.map((detection) => detection.occurredAt.getTime())),
  );
  const histories: ModerationConfigHistoryRow[] = await client.guildPluginConfigHistory.findMany({
    where: {
      guildId,
      pluginId: 'moderation',
      createdAt: { lte: latestOccurredAt },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, config: true },
  });

  const snapshots = new Map<string, string>();
  for (const detection of candidates) {
    if (!isWordRuleKind(detection.detectionKind) || detection.ruleIndex === null) continue;
    const history = findConfigAt(histories, detection.occurredAt);
    if (!history) continue;
    const config = normalizeModerationConfig(history.config);
    const value = ruleValues(config, detection.detectionKind)[detection.ruleIndex];
    if (value) snapshots.set(detection.id, value);
  }
  return snapshots;
}

export function legacyRuleReference(ruleIndex: number | null): string | null {
  return ruleIndex === null ? null : `旧履歴 · Rule #${ruleIndex + 1}`;
}

function findConfigAt(
  histories: readonly ModerationConfigHistoryRow[],
  occurredAt: Date,
): ModerationConfigHistoryRow | undefined {
  for (let index = histories.length - 1; index >= 0; index -= 1) {
    const history = histories[index];
    if (history && history.createdAt.getTime() <= occurredAt.getTime()) return history;
  }
  return undefined;
}

function isWordRuleKind(kind: ModerationDetectionKind): kind is ModerationWordRuleKind {
  return kind === 'word_exact' || kind === 'word_contains' || kind === 'word_regex';
}

function ruleValues(
  config: ReturnType<typeof normalizeModerationConfig>,
  kind: ModerationWordRuleKind,
): string[] {
  if (kind === 'word_exact') return config.autoExactWords;
  if (kind === 'word_regex') return config.autoRegexPatterns;
  return config.autoContainsWords;
}
