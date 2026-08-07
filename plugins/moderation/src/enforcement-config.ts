import {
  AUTOMATIC_CASE_RULE_SELECTOR_PATTERN,
  createAutomaticCaseRuleSelector,
} from './auto-case.js';
import type { AutomaticModerationFinding } from './detection.js';

export const AUTOMATIC_ENFORCEMENT_ACTIONS = [
  'observe',
  'warn',
  'delete',
  'warn_delete',
  'timeout',
  'role',
  'blacklist',
  'kick',
  'ban',
] as const;

export const AUTOMATIC_MODERATION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type AutomaticEnforcementAction = (typeof AUTOMATIC_ENFORCEMENT_ACTIONS)[number];
export type AutomaticModerationSeverity = (typeof AUTOMATIC_MODERATION_SEVERITIES)[number];

export interface AutomaticEnforcementPolicy {
  selector: string;
  action: AutomaticEnforcementAction;
  severity: AutomaticModerationSeverity;
  timeoutMinutes: number;
  roleId: string | null;
  warningMessage: string | null;
  banDeleteMessageSeconds: number;
}

export interface ModerationEnforcementConfig {
  autoEnforcementEnabled: boolean;
  autoEnforcementPolicies: AutomaticEnforcementPolicy[];
  autoAlertChannelId: string | null;
  autoAlertMinimumSeverity: AutomaticModerationSeverity;
  autoAlertMentionRoleIds: string[];
  autoAlertIncludeExcerpt: boolean;
  autoAlertCooldownSeconds: number;
}

export const DEFAULT_MODERATION_ENFORCEMENT_CONFIG: ModerationEnforcementConfig = {
  autoEnforcementEnabled: false,
  autoEnforcementPolicies: [],
  autoAlertChannelId: null,
  autoAlertMinimumSeverity: 'high',
  autoAlertMentionRoleIds: [],
  autoAlertIncludeExcerpt: false,
  autoAlertCooldownSeconds: 60,
};

export const AUTOMATIC_ENFORCEMENT_RULE_SELECTOR_PATTERN = AUTOMATIC_CASE_RULE_SELECTOR_PATTERN;
export const MAX_AUTOMATIC_WARNING_MESSAGE_LENGTH = 500;
export const MAX_AUTOMATIC_TIMEOUT_MINUTES = 28 * 24 * 60;
export const MAX_AUTOMATIC_BAN_DELETE_MESSAGE_SECONDS = 7 * 24 * 60 * 60;
export const MAX_AUTOMATIC_ALERT_COOLDOWN_SECONDS = 60 * 60;

const actionSet = new Set<string>(AUTOMATIC_ENFORCEMENT_ACTIONS);
const severitySet = new Set<string>(AUTOMATIC_MODERATION_SEVERITIES);
const severityRank: Record<AutomaticModerationSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function normalizeModerationEnforcementConfig(value: unknown): ModerationEnforcementConfig {
  const source = isRecord(value) ? value : {};
  return {
    autoEnforcementEnabled: booleanValue(
      source.autoEnforcementEnabled,
      DEFAULT_MODERATION_ENFORCEMENT_CONFIG.autoEnforcementEnabled,
    ),
    autoEnforcementPolicies: normalizePolicies(source.autoEnforcementPolicies),
    autoAlertChannelId: normalizeDiscordId(source.autoAlertChannelId),
    autoAlertMinimumSeverity: normalizeSeverity(
      source.autoAlertMinimumSeverity,
      DEFAULT_MODERATION_ENFORCEMENT_CONFIG.autoAlertMinimumSeverity,
    ),
    autoAlertMentionRoleIds: normalizeDiscordIds(source.autoAlertMentionRoleIds),
    autoAlertIncludeExcerpt: booleanValue(
      source.autoAlertIncludeExcerpt,
      DEFAULT_MODERATION_ENFORCEMENT_CONFIG.autoAlertIncludeExcerpt,
    ),
    autoAlertCooldownSeconds: clampInteger(
      source.autoAlertCooldownSeconds,
      DEFAULT_MODERATION_ENFORCEMENT_CONFIG.autoAlertCooldownSeconds,
      0,
      MAX_AUTOMATIC_ALERT_COOLDOWN_SECONDS,
    ),
  };
}

export function resolveAutomaticEnforcementPolicy(
  policies: AutomaticEnforcementPolicy[],
  finding: Pick<AutomaticModerationFinding, 'kind' | 'ruleIndex'>,
): AutomaticEnforcementPolicy {
  const selector = createAutomaticCaseRuleSelector({
    detectionKind: finding.kind,
    ruleIndex: finding.ruleIndex ?? null,
  });
  if (!selector) return defaultPolicy(finding.kind);
  return policies.find((policy) => policy.selector === selector) ?? defaultPolicy(selector);
}

export function isSeverityAtLeast(
  severity: AutomaticModerationSeverity,
  minimum: AutomaticModerationSeverity,
): boolean {
  return severityRank[severity] >= severityRank[minimum];
}

export function automaticEnforcementSelector(
  finding: Pick<AutomaticModerationFinding, 'kind' | 'ruleIndex'>,
): string | null {
  return createAutomaticCaseRuleSelector({
    detectionKind: finding.kind,
    ruleIndex: finding.ruleIndex ?? null,
  });
}

function defaultPolicy(selector: string): AutomaticEnforcementPolicy {
  return {
    selector,
    action: 'observe',
    severity: 'low',
    timeoutMinutes: 10,
    roleId: null,
    warningMessage: null,
    banDeleteMessageSeconds: 0,
  };
}

function normalizePolicies(value: unknown): AutomaticEnforcementPolicy[] {
  if (!Array.isArray(value)) return [];
  const selectorPattern = new RegExp(AUTOMATIC_ENFORCEMENT_RULE_SELECTOR_PATTERN, 'u');
  const result = new Map<string, AutomaticEnforcementPolicy>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const selector = typeof item.selector === 'string' ? item.selector.trim() : '';
    if (!selectorPattern.test(selector)) continue;
    const action = normalizeAction(item.action);
    result.set(selector, {
      selector,
      action,
      severity: normalizeSeverity(item.severity, 'low'),
      timeoutMinutes: clampInteger(item.timeoutMinutes, 10, 1, MAX_AUTOMATIC_TIMEOUT_MINUTES),
      roleId: normalizeDiscordId(item.roleId),
      warningMessage: normalizeNullableString(
        item.warningMessage,
        MAX_AUTOMATIC_WARNING_MESSAGE_LENGTH,
      ),
      banDeleteMessageSeconds: clampInteger(
        item.banDeleteMessageSeconds,
        0,
        0,
        MAX_AUTOMATIC_BAN_DELETE_MESSAGE_SECONDS,
      ),
    });
  }
  return [...result.values()].slice(0, 200);
}

function normalizeAction(value: unknown): AutomaticEnforcementAction {
  return typeof value === 'string' && actionSet.has(value)
    ? (value as AutomaticEnforcementAction)
    : 'observe';
}

function normalizeSeverity(
  value: unknown,
  fallback: AutomaticModerationSeverity,
): AutomaticModerationSeverity {
  return typeof value === 'string' && severitySet.has(value)
    ? (value as AutomaticModerationSeverity)
    : fallback;
}

function normalizeNullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeDiscordId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' && /^\d+$/.test(value.trim()) ? value.trim() : null;
}

function normalizeDiscordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => /^\d+$/.test(item)),
    ),
  ];
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
  return Math.min(Math.max(normalized, minimum), maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
