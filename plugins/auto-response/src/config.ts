import { Script } from 'node:vm';

export type AutoResponseMatchMode = 'exact' | 'partial' | 'prefix' | 'regex';
export type AutoResponseResponseType = 'text' | 'embed';

export interface AutoResponseConfig {
  maxRules: number;
  maxRulesPerMessage: number;
  guildCooldownSeconds: number;
  defaultRuleCooldownSeconds: number;
  maxTriggerLength: number;
  maxResponseLength: number;
  maxMessageLength: number;
  regexEnabled: boolean;
  regexMaxLength: number;
  regexExecutionBudgetMs: number;
  allowUserMentions: boolean;
}

export interface AutoResponseRuleInput {
  name: unknown;
  triggerValue: unknown;
  matchMode: unknown;
  responseType: unknown;
  responseContent: unknown;
  channelIds?: unknown;
  roleIds?: unknown;
  cooldownSeconds?: unknown;
  priority?: unknown;
  caseSensitive?: unknown;
  enabled?: unknown;
}

export interface NormalizedAutoResponseRuleInput {
  name: string;
  triggerValue: string;
  matchMode: AutoResponseMatchMode;
  responseType: AutoResponseResponseType;
  responseContent: string;
  channelIds: string[];
  roleIds: string[];
  cooldownSeconds: number;
  priority: number;
  caseSensitive: boolean;
  enabled: boolean;
}

export interface AutoResponseEmbed {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export const DEFAULT_AUTO_RESPONSE_CONFIG: AutoResponseConfig = {
  maxRules: 100,
  maxRulesPerMessage: 1,
  guildCooldownSeconds: 1,
  defaultRuleCooldownSeconds: 5,
  maxTriggerLength: 100,
  maxResponseLength: 1800,
  maxMessageLength: 2000,
  regexEnabled: true,
  regexMaxLength: 100,
  regexExecutionBudgetMs: 10,
  allowUserMentions: false,
};

const DISCORD_ID_PATTERN = /^\d{1,20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCKED_MENTION_PATTERN = /@everyone|@here|<@&\d+>/i;
const MAX_SCOPE_IDS = 25;
const MAX_RULE_NAME_LENGTH = 80;
const MAX_EMBED_FIELDS = 10;
const REGEX_MATCH_SCRIPT = new Script('RegExp(pattern, flags).test(content)');

export class AutoResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutoResponseValidationError';
  }
}

export function normalizeAutoResponseConfig(value: unknown): AutoResponseConfig {
  const config = isRecord(value) ? value : {};
  return {
    maxRules: clampInteger(config.maxRules, DEFAULT_AUTO_RESPONSE_CONFIG.maxRules, 1, 200),
    maxRulesPerMessage: clampInteger(
      config.maxRulesPerMessage,
      DEFAULT_AUTO_RESPONSE_CONFIG.maxRulesPerMessage,
      1,
      5,
    ),
    guildCooldownSeconds: clampInteger(
      config.guildCooldownSeconds,
      DEFAULT_AUTO_RESPONSE_CONFIG.guildCooldownSeconds,
      0,
      3600,
    ),
    defaultRuleCooldownSeconds: clampInteger(
      config.defaultRuleCooldownSeconds,
      DEFAULT_AUTO_RESPONSE_CONFIG.defaultRuleCooldownSeconds,
      0,
      86400,
    ),
    maxTriggerLength: clampInteger(
      config.maxTriggerLength,
      DEFAULT_AUTO_RESPONSE_CONFIG.maxTriggerLength,
      1,
      200,
    ),
    maxResponseLength: clampInteger(
      config.maxResponseLength,
      DEFAULT_AUTO_RESPONSE_CONFIG.maxResponseLength,
      1,
      2000,
    ),
    maxMessageLength: clampInteger(
      config.maxMessageLength,
      DEFAULT_AUTO_RESPONSE_CONFIG.maxMessageLength,
      1,
      4000,
    ),
    regexEnabled: booleanValue(config.regexEnabled, DEFAULT_AUTO_RESPONSE_CONFIG.regexEnabled),
    regexMaxLength: clampInteger(
      config.regexMaxLength,
      DEFAULT_AUTO_RESPONSE_CONFIG.regexMaxLength,
      1,
      200,
    ),
    regexExecutionBudgetMs: clampInteger(
      config.regexExecutionBudgetMs,
      DEFAULT_AUTO_RESPONSE_CONFIG.regexExecutionBudgetMs,
      1,
      50,
    ),
    allowUserMentions: booleanValue(
      config.allowUserMentions,
      DEFAULT_AUTO_RESPONSE_CONFIG.allowUserMentions,
    ),
  };
}

export function normalizeAutoResponseRuleInput(
  value: AutoResponseRuleInput,
  config: AutoResponseConfig,
): NormalizedAutoResponseRuleInput {
  const matchMode = normalizeMatchMode(value.matchMode);
  const responseType = normalizeResponseType(value.responseType);
  const triggerValue = normalizeTrigger(value.triggerValue, matchMode, config);

  return {
    name: requiredText(value.name, MAX_RULE_NAME_LENGTH, 'ルール名'),
    triggerValue,
    matchMode,
    responseType,
    responseContent: normalizeResponseContent(value.responseContent, responseType, config),
    channelIds: normalizeDiscordIds(value.channelIds, 'チャンネルID'),
    roleIds: normalizeDiscordIds(value.roleIds, 'ロールID'),
    cooldownSeconds: clampInteger(
      value.cooldownSeconds,
      config.defaultRuleCooldownSeconds,
      0,
      86400,
    ),
    priority: clampInteger(value.priority, 0, -1000, 1000),
    caseSensitive: booleanValue(value.caseSensitive, false),
    enabled: booleanValue(value.enabled, true),
  };
}

export function matchesAutoResponse(
  content: string,
  rule: Pick<NormalizedAutoResponseRuleInput, 'triggerValue' | 'matchMode' | 'caseSensitive'>,
  config: AutoResponseConfig,
): boolean {
  if (!content || content.length > config.maxMessageLength) return false;
  const source = rule.caseSensitive ? content : content.toLocaleLowerCase('ja-JP');
  const trigger = rule.caseSensitive
    ? rule.triggerValue
    : rule.triggerValue.toLocaleLowerCase('ja-JP');

  switch (rule.matchMode) {
    case 'exact':
      return source === trigger;
    case 'partial':
      return source.includes(trigger);
    case 'prefix':
      return source.startsWith(trigger);
    case 'regex': {
      if (!config.regexEnabled) return false;
      assertSafeRegex(rule.triggerValue, config.regexMaxLength);
      try {
        return Boolean(
          REGEX_MATCH_SCRIPT.runInNewContext(
            {
              pattern: rule.triggerValue,
              flags: rule.caseSensitive ? 'u' : 'iu',
              content,
            },
            {
              timeout: config.regexExecutionBudgetMs,
              contextCodeGeneration: { strings: false, wasm: false },
            },
          ),
        );
      } catch (error) {
        if (isRegexExecutionTimeout(error)) {
          throw new AutoResponseValidationError('正規表現の評価時間が上限を超えました');
        }
        throw error;
      }
    }
  }
}

export function parseAutoResponseEmbed(value: string): AutoResponseEmbed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AutoResponseValidationError('Embed応答は有効なJSONで入力してください');
  }
  if (!isRecord(parsed)) {
    throw new AutoResponseValidationError('Embed応答はJSONオブジェクトで入力してください');
  }

  const embed: AutoResponseEmbed = {};
  if (parsed.title !== undefined) embed.title = optionalText(parsed.title, 256, 'Embedタイトル');
  if (parsed.description !== undefined) {
    embed.description = optionalText(parsed.description, 1800, 'Embed本文');
  }
  if (parsed.color !== undefined) {
    if (
      !Number.isSafeInteger(parsed.color) ||
      Number(parsed.color) < 0 ||
      Number(parsed.color) > 0xffffff
    ) {
      throw new AutoResponseValidationError('Embedカラーは0〜16777215の整数で指定してください');
    }
    embed.color = Number(parsed.color);
  }
  if (parsed.footer !== undefined) {
    if (!isRecord(parsed.footer)) {
      throw new AutoResponseValidationError('Embedフッターが不正です');
    }
    embed.footer = { text: requiredText(parsed.footer.text, 512, 'Embedフッター') };
  }
  if (parsed.fields !== undefined) {
    if (!Array.isArray(parsed.fields) || parsed.fields.length > MAX_EMBED_FIELDS) {
      throw new AutoResponseValidationError(`Embedフィールドは最大${MAX_EMBED_FIELDS}件です`);
    }
    embed.fields = parsed.fields.map((field, index) => {
      if (!isRecord(field)) {
        throw new AutoResponseValidationError(`Embedフィールド${index + 1}が不正です`);
      }
      return {
        name: requiredText(field.name, 256, `Embedフィールド${index + 1}名`),
        value: requiredText(field.value, 1024, `Embedフィールド${index + 1}本文`),
        ...(typeof field.inline === 'boolean' ? { inline: field.inline } : {}),
      };
    });
  }

  if (!embed.title && !embed.description && (!embed.fields || embed.fields.length === 0)) {
    throw new AutoResponseValidationError(
      'Embedにはタイトル、本文、フィールドのいずれかが必要です',
    );
  }
  return embed;
}

export function assertDiscordId(value: string, label: string): void {
  if (!DISCORD_ID_PATTERN.test(value)) {
    throw new AutoResponseValidationError(`${label}が不正です`);
  }
}

export function assertRuleId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new AutoResponseValidationError('ルールIDが不正です');
  }
}

export function assertSafeRegex(pattern: string, maxLength: number): void {
  if (pattern.length > maxLength) {
    throw new AutoResponseValidationError(`正規表現は${maxLength}文字以内で入力してください`);
  }
  if (
    /\\[1-9]/.test(pattern) ||
    /\(\?(?:[=!]|<[=!]|>)/.test(pattern) ||
    /\([^)]*(?:\*|\+|\{\d+(?:,\d*)?\})[^)]*\)(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern) ||
    /\((?:\?:)?[^()]*\|[^()]*\)(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern) ||
    /(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern)
  ) {
    throw new AutoResponseValidationError('安全でない正規表現パターンは利用できません');
  }
  try {
    new RegExp(pattern, 'u');
  } catch {
    throw new AutoResponseValidationError('正規表現の構文が不正です');
  }
}

function isRegexExecutionTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
  );
}

function normalizeTrigger(
  value: unknown,
  matchMode: AutoResponseMatchMode,
  config: AutoResponseConfig,
): string {
  const maxLength = matchMode === 'regex' ? config.regexMaxLength : config.maxTriggerLength;
  const trigger = requiredText(value, maxLength, 'トリガー');
  if (matchMode === 'regex') {
    if (!config.regexEnabled) {
      throw new AutoResponseValidationError('このGuildでは正規表現ルールが無効です');
    }
    assertSafeRegex(trigger, config.regexMaxLength);
  }
  return trigger;
}

function normalizeResponseContent(
  value: unknown,
  responseType: AutoResponseResponseType,
  config: AutoResponseConfig,
): string {
  if (typeof value !== 'string') {
    throw new AutoResponseValidationError('応答内容を入力してください');
  }
  if (responseType === 'text') {
    const content = requiredText(value, config.maxResponseLength, '応答内容');
    assertNoBlockedMentions(content);
    return content;
  }

  const embed = parseAutoResponseEmbed(value);
  const serialized = JSON.stringify(embed);
  if (serialized.length > config.maxResponseLength * 2) {
    throw new AutoResponseValidationError('Embed応答が長すぎます');
  }
  for (const text of collectEmbedText(embed)) assertNoBlockedMentions(text);
  return serialized;
}

function collectEmbedText(embed: AutoResponseEmbed): string[] {
  return [
    embed.title,
    embed.description,
    embed.footer?.text,
    ...(embed.fields?.flatMap((field) => [field.name, field.value]) ?? []),
  ].filter((value): value is string => Boolean(value));
}

function assertNoBlockedMentions(value: string): void {
  if (BLOCKED_MENTION_PATTERN.test(value)) {
    throw new AutoResponseValidationError('@everyone、@here、ロールメンションは利用できません');
  }
}

function normalizeDiscordIds(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SCOPE_IDS) {
    throw new AutoResponseValidationError(
      `${label}は最大${MAX_SCOPE_IDS}件の配列で指定してください`,
    );
  }
  const normalized = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (normalized.some((item) => !DISCORD_ID_PATTERN.test(item))) {
    throw new AutoResponseValidationError(`${label}に不正な値が含まれています`);
  }
  return normalized;
}

function normalizeMatchMode(value: unknown): AutoResponseMatchMode {
  if (value === 'exact' || value === 'partial' || value === 'prefix' || value === 'regex') {
    return value;
  }
  throw new AutoResponseValidationError('一致方式が不正です');
}

function normalizeResponseType(value: unknown): AutoResponseResponseType {
  if (value === 'text' || value === 'embed') return value;
  throw new AutoResponseValidationError('応答形式が不正です');
}

function requiredText(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== 'string')
    throw new AutoResponseValidationError(`${label}を入力してください`);
  const normalized = value.trim();
  if (!normalized) throw new AutoResponseValidationError(`${label}を入力してください`);
  if (normalized.length > maxLength) {
    throw new AutoResponseValidationError(`${label}は${maxLength}文字以内で入力してください`);
  }
  return normalized;
}

function optionalText(value: unknown, maxLength: number, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredText(value, maxLength, label);
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
  return Math.min(Math.max(normalized, minimum), maximum);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
