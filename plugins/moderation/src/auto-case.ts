import type { ModerationConfig } from './config.js';
import type { AutomaticModerationFindingKind } from './detection.js';

export const AUTOMATIC_CASE_RULE_SELECTOR_PATTERN =
  '^(?:(?:word_exact|word_contains|word_regex):(?:0|[1-9]\\d*)|invite_link|mention_burst|message_burst|duplicate_message)$';

const WORD_RULE_KINDS = new Set<AutomaticModerationFindingKind>([
  'word_exact',
  'word_contains',
  'word_regex',
]);

export interface AutomaticCaseDetectionSelectorInput {
  detectionKind: AutomaticModerationFindingKind;
  ruleIndex: number | null;
}

export function createAutomaticCaseRuleSelector(
  input: AutomaticCaseDetectionSelectorInput,
): string | null {
  if (WORD_RULE_KINDS.has(input.detectionKind)) {
    if (!Number.isSafeInteger(input.ruleIndex) || (input.ruleIndex ?? -1) < 0) return null;
    return `${input.detectionKind}:${input.ruleIndex}`;
  }
  return input.detectionKind;
}

export function shouldAutoCreateCaseOnConfirmed(
  config: Pick<ModerationConfig, 'autoCaseOnConfirmedEnabled' | 'autoCaseOnConfirmedRules'>,
  detection: AutomaticCaseDetectionSelectorInput,
): boolean {
  if (!config.autoCaseOnConfirmedEnabled) return false;
  const selector = createAutomaticCaseRuleSelector(detection);
  return selector !== null && config.autoCaseOnConfirmedRules.includes(selector);
}
