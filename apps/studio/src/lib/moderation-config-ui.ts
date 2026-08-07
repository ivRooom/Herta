export type CustomRuleKind = 'word_exact' | 'word_contains' | 'word_regex';

export type ModerationConfigDraft = {
  requireReason: boolean;
  dmTarget: boolean;
  logChannelId: string | null;
  defaultResponseEphemeral: boolean;
  maxReasonLength: number;
  caseRetentionDays: number;
  allowedModeratorRoleIds: string[];
  automaticMode: 'disabled' | 'observe';
  autoCaseOnConfirmedEnabled: boolean;
  autoCaseOnConfirmedRules: string[];
  autoExactWords: string[];
  autoContainsWords: string[];
  autoRegexPatterns: string[];
  autoInviteFilterEnabled: boolean;
  autoInviteAllowlist: string[];
  autoMentionLimit: number;
  autoBurstMessageLimit: number;
  autoBurstWindowSeconds: number;
  autoDuplicateMessageLimit: number;
  autoDuplicateWindowSeconds: number;
  autoMaxMessageLength: number;
  autoExemptChannelIds: string[];
  autoExemptRoleIds: string[];
  autoExemptUserIds: string[];
};

export const DEFAULT_MODERATION_CONFIG_DRAFT: ModerationConfigDraft = {
  requireReason: true,
  dmTarget: true,
  logChannelId: null,
  defaultResponseEphemeral: true,
  maxReasonLength: 500,
  caseRetentionDays: 365,
  allowedModeratorRoleIds: [],
  automaticMode: 'disabled',
  autoCaseOnConfirmedEnabled: false,
  autoCaseOnConfirmedRules: [],
  autoExactWords: [],
  autoContainsWords: [],
  autoRegexPatterns: [],
  autoInviteFilterEnabled: false,
  autoInviteAllowlist: [],
  autoMentionLimit: 0,
  autoBurstMessageLimit: 0,
  autoBurstWindowSeconds: 10,
  autoDuplicateMessageLimit: 0,
  autoDuplicateWindowSeconds: 30,
  autoMaxMessageLength: 2000,
  autoExemptChannelIds: [],
  autoExemptRoleIds: [],
  autoExemptUserIds: [],
};

const CUSTOM_RULE_KEYS: Record<CustomRuleKind, keyof ModerationConfigDraft> = {
  word_exact: 'autoExactWords',
  word_contains: 'autoContainsWords',
  word_regex: 'autoRegexPatterns',
};

export function toModerationConfigDraft(value: unknown): ModerationConfigDraft {
  const source = isRecord(value) ? value : {};
  const defaults = DEFAULT_MODERATION_CONFIG_DRAFT;

  return {
    requireReason: booleanValue(source.requireReason, defaults.requireReason),
    dmTarget: booleanValue(source.dmTarget, defaults.dmTarget),
    logChannelId: nullableString(source.logChannelId),
    defaultResponseEphemeral: booleanValue(
      source.defaultResponseEphemeral,
      defaults.defaultResponseEphemeral,
    ),
    maxReasonLength: integerValue(source.maxReasonLength, defaults.maxReasonLength),
    caseRetentionDays: integerValue(source.caseRetentionDays, defaults.caseRetentionDays),
    allowedModeratorRoleIds: stringArray(source.allowedModeratorRoleIds),
    automaticMode: source.automaticMode === 'observe' ? 'observe' : 'disabled',
    autoCaseOnConfirmedEnabled: booleanValue(
      source.autoCaseOnConfirmedEnabled,
      defaults.autoCaseOnConfirmedEnabled,
    ),
    autoCaseOnConfirmedRules: stringArray(source.autoCaseOnConfirmedRules),
    autoExactWords: stringArray(source.autoExactWords),
    autoContainsWords: stringArray(source.autoContainsWords),
    autoRegexPatterns: stringArray(source.autoRegexPatterns),
    autoInviteFilterEnabled: booleanValue(
      source.autoInviteFilterEnabled,
      defaults.autoInviteFilterEnabled,
    ),
    autoInviteAllowlist: stringArray(source.autoInviteAllowlist),
    autoMentionLimit: integerValue(source.autoMentionLimit, defaults.autoMentionLimit),
    autoBurstMessageLimit: integerValue(
      source.autoBurstMessageLimit,
      defaults.autoBurstMessageLimit,
    ),
    autoBurstWindowSeconds: integerValue(
      source.autoBurstWindowSeconds,
      defaults.autoBurstWindowSeconds,
    ),
    autoDuplicateMessageLimit: integerValue(
      source.autoDuplicateMessageLimit,
      defaults.autoDuplicateMessageLimit,
    ),
    autoDuplicateWindowSeconds: integerValue(
      source.autoDuplicateWindowSeconds,
      defaults.autoDuplicateWindowSeconds,
    ),
    autoMaxMessageLength: integerValue(source.autoMaxMessageLength, defaults.autoMaxMessageLength),
    autoExemptChannelIds: stringArray(source.autoExemptChannelIds),
    autoExemptRoleIds: stringArray(source.autoExemptRoleIds),
    autoExemptUserIds: stringArray(source.autoExemptUserIds),
  };
}

export function customRuleValues(
  config: ModerationConfigDraft,
  kind: CustomRuleKind,
): string[] {
  return config[CUSTOM_RULE_KEYS[kind]] as string[];
}

export function customRuleSelector(kind: CustomRuleKind, index: number): string {
  return `${kind}:${index}`;
}

export function appendCustomRule(
  config: ModerationConfigDraft,
  kind: CustomRuleKind,
  value: string,
): ModerationConfigDraft {
  const key = CUSTOM_RULE_KEYS[kind];
  const current = config[key] as string[];
  return { ...config, [key]: [...current, value] };
}

export function updateCustomRule(
  config: ModerationConfigDraft,
  kind: CustomRuleKind,
  index: number,
  value: string,
): ModerationConfigDraft {
  const key = CUSTOM_RULE_KEYS[kind];
  const current = config[key] as string[];
  if (index < 0 || index >= current.length) return config;
  return {
    ...config,
    [key]: current.map((item, itemIndex) => (itemIndex === index ? value : item)),
  };
}

export function removeCustomRule(
  config: ModerationConfigDraft,
  kind: CustomRuleKind,
  index: number,
): ModerationConfigDraft {
  const key = CUSTOM_RULE_KEYS[kind];
  const current = config[key] as string[];
  if (index < 0 || index >= current.length) return config;

  const prefix = `${kind}:`;
  const selectors = config.autoCaseOnConfirmedRules.flatMap((selector) => {
    if (!selector.startsWith(prefix)) return [selector];
    const selectedIndex = Number.parseInt(selector.slice(prefix.length), 10);
    if (!Number.isInteger(selectedIndex)) return [selector];
    if (selectedIndex === index) return [];
    if (selectedIndex > index) return [`${kind}:${selectedIndex - 1}`];
    return [selector];
  });

  return {
    ...config,
    [key]: current.filter((_, itemIndex) => itemIndex !== index),
    autoCaseOnConfirmedRules: unique(selectors),
  };
}

export function setAutoCaseRule(
  config: ModerationConfigDraft,
  selector: string,
  enabled: boolean,
): ModerationConfigDraft {
  const selectors = enabled
    ? unique([...config.autoCaseOnConfirmedRules, selector])
    : config.autoCaseOnConfirmedRules.filter((item) => item !== selector);
  return { ...config, autoCaseOnConfirmedRules: selectors };
}

export function setBuiltInRuleEnabled(
  config: ModerationConfigDraft,
  kind: 'invite_link' | 'mention_burst' | 'message_burst' | 'duplicate_message',
  enabled: boolean,
): ModerationConfigDraft {
  let next = config;
  switch (kind) {
    case 'invite_link':
      next = { ...config, autoInviteFilterEnabled: enabled };
      break;
    case 'mention_burst':
      next = { ...config, autoMentionLimit: enabled ? Math.max(config.autoMentionLimit, 5) : 0 };
      break;
    case 'message_burst':
      next = {
        ...config,
        autoBurstMessageLimit: enabled ? Math.max(config.autoBurstMessageLimit, 5) : 0,
      };
      break;
    case 'duplicate_message':
      next = {
        ...config,
        autoDuplicateMessageLimit: enabled ? Math.max(config.autoDuplicateMessageLimit, 3) : 0,
      };
      break;
  }
  return enabled ? next : setAutoCaseRule(next, kind, false);
}

export function isBuiltInRuleEnabled(
  config: ModerationConfigDraft,
  kind: 'invite_link' | 'mention_burst' | 'message_burst' | 'duplicate_message',
): boolean {
  switch (kind) {
    case 'invite_link':
      return config.autoInviteFilterEnabled;
    case 'mention_burst':
      return config.autoMentionLimit > 0;
    case 'message_burst':
      return config.autoBurstMessageLimit > 0;
    case 'duplicate_message':
      return config.autoDuplicateMessageLimit > 0;
  }
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integerValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
