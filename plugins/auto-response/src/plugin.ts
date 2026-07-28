import { definePlugin } from '@herta/plugin-sdk';
import type { PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  matchesAutoResponse,
  normalizeAutoResponseConfig,
  parseAutoResponseEmbed,
  type AutoResponseConfig,
} from './config.js';
import { recordPreparationFailureIfDue } from './failure-throttle.js';
import { autoResponseManifest } from './manifest.js';
import {
  claimAutoResponseRule,
  listEnabledAutoResponseRules,
  recordAutoResponseExecution,
  type AutoResponsePrismaClient,
  type AutoResponseRuleRecord,
} from './service.js';

const VIEW_CHANNEL_PERMISSION = 1024n;
const SEND_MESSAGES_PERMISSION = 2048n;
const EMBED_LINKS_PERMISSION = 16384n;
const SEND_MESSAGES_IN_THREADS_PERMISSION = 274877906944n;
const RULE_CACHE_TTL_MS = 10_000;

interface AutoResponseRoleCache {
  has(roleId: string): boolean;
}

interface AutoResponseMessage {
  id: string;
  guildId: string | null;
  channelId: string;
  content: string;
  webhookId: string | null;
  system: boolean;
  author: { id: string; bot: boolean };
  member: { roles: { cache: AutoResponseRoleCache } } | null;
  guild: { members: { me: unknown | null } } | null;
  channel: {
    isTextBased?(): boolean;
    isThread?(): boolean;
    permissionsFor?(member: unknown): { has(permission: bigint): boolean } | null;
    send(options: AutoResponseSendOptions): Promise<unknown>;
  };
}

interface AutoResponseSendOptions {
  content?: string;
  embeds?: unknown[];
  allowedMentions: { parse: string[] };
}

type AutoResponseRuntimeContext = PluginRuntimeContext<
  AutoResponseConfig,
  unknown,
  AutoResponsePrismaClient
>;

interface CachedRules {
  expiresAt: number;
  rules: AutoResponseRuleRecord[];
}

const ruleCache = new Map<string, CachedRules>();

export const autoResponsePlugin = definePlugin<
  AutoResponseConfig,
  unknown,
  AutoResponsePrismaClient
>({
  manifest: autoResponseManifest,

  async onEnable(context) {
    ruleCache.delete(context.guildId);
    context.logger.info('Auto Response Pluginを有効化しました');
  },

  async onDisable(context) {
    ruleCache.delete(context.guildId);
    context.logger.info('Auto Response Pluginを無効化しました');
  },

  provideEvents() {
    return [
      {
        event: 'messageCreate',
        async handler(context, ...args) {
          const message = args[0] as AutoResponseMessage | undefined;
          if (!message) return;
          await executeAutoResponse(context, message);
        },
      },
    ];
  },
});

async function executeAutoResponse(
  context: AutoResponseRuntimeContext,
  message: AutoResponseMessage,
): Promise<void> {
  if (
    !message.guildId ||
    message.guildId !== context.guildId ||
    message.author.bot ||
    message.webhookId ||
    message.system ||
    !message.content
  ) {
    return;
  }

  const config = normalizeAutoResponseConfig(context.config);
  if (message.content.length > config.maxMessageLength) return;

  let rules: AutoResponseRuleRecord[];
  try {
    rules = await getCachedRules(context, config);
  } catch (error) {
    context.logger.error(
      { err: error, guildId: context.guildId, channelId: message.channelId },
      'Auto Responseルールの取得に失敗しました',
    );
    return;
  }

  let responseCount = 0;
  let regexEvaluationCount = 0;
  let regexLimitLogged = false;
  for (const rule of rules) {
    if (responseCount >= config.maxRulesPerMessage) break;
    if (!isRuleInScope(rule, message)) continue;
    if (rule.matchMode === 'regex') {
      if (regexEvaluationCount >= config.maxRegexEvaluationsPerMessage) {
        if (!regexLimitLogged) {
          context.logger.warn(
            {
              guildId: context.guildId,
              channelId: message.channelId,
              maxRegexEvaluationsPerMessage: config.maxRegexEvaluationsPerMessage,
            },
            'Auto Responseの正規表現評価上限に達しました',
          );
          regexLimitLogged = true;
        }
        continue;
      }
      regexEvaluationCount += 1;
    }

    const startedAt = Date.now();
    let matched = false;
    try {
      matched = matchesAutoResponse(message.content, rule, config);
    } catch (error) {
      await safelyRecordExecution(context, {
        guildId: context.guildId,
        ruleId: rule.id,
        status: 'failure',
        durationMs: Date.now() - startedAt,
        errorName: resolveErrorName(error),
      });
      context.logger.warn(
        { err: error, guildId: context.guildId, ruleId: rule.id },
        'Auto Responseルールの評価を停止しました',
      );
      continue;
    }
    if (!matched) continue;

    let response: AutoResponseSendOptions;
    try {
      assertBotCanRespond(message, rule.responseType);
      response = buildResponse(rule, config);
    } catch (error) {
      const recorded = await safelyRecordPreparationFailure(context, {
        guildId: context.guildId,
        ruleId: rule.id,
        durationMs: Date.now() - startedAt,
        errorName: resolveErrorName(error),
      });
      if (recorded) {
        context.logger.warn(
          {
            err: error,
            guildId: context.guildId,
            channelId: message.channelId,
            ruleId: rule.id,
          },
          'Auto Responseの送信準備に失敗しました',
        );
      }
      continue;
    }

    let claimResult: Awaited<ReturnType<typeof claimAutoResponseRule>>;
    try {
      claimResult = await claimAutoResponseRule(context.prisma, {
        guildId: context.guildId,
        ruleId: rule.id,
        guildCooldownSeconds: config.guildCooldownSeconds,
      });
    } catch (error) {
      context.logger.error(
        { err: error, guildId: context.guildId, ruleId: rule.id },
        'Auto Response Cooldownの確保に失敗しました',
      );
      continue;
    }

    if (claimResult !== 'claimed') {
      await safelyRecordExecution(context, {
        guildId: context.guildId,
        ruleId: rule.id,
        status: 'skipped',
        durationMs: Date.now() - startedAt,
        errorName: claimResult,
      });
      if (claimResult === 'guild_cooldown') break;
      continue;
    }

    try {
      await message.channel.send(response);
      responseCount += 1;
      await safelyRecordExecution(context, {
        guildId: context.guildId,
        ruleId: rule.id,
        status: 'success',
        durationMs: Date.now() - startedAt,
        errorName: null,
      });
      context.logger.debug(
        {
          guildId: context.guildId,
          channelId: message.channelId,
          ruleId: rule.id,
          durationMs: Date.now() - startedAt,
        },
        'Auto Responseを送信しました',
      );
    } catch (error) {
      await safelyRecordExecution(context, {
        guildId: context.guildId,
        ruleId: rule.id,
        status: 'failure',
        durationMs: Date.now() - startedAt,
        errorName: resolveErrorName(error),
      });
      context.logger.warn(
        {
          err: error,
          guildId: context.guildId,
          channelId: message.channelId,
          ruleId: rule.id,
        },
        'Auto Responseの送信に失敗しました',
      );
    }
  }
}

async function getCachedRules(
  context: AutoResponseRuntimeContext,
  config: AutoResponseConfig,
): Promise<AutoResponseRuleRecord[]> {
  const cached = ruleCache.get(context.guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.rules;
  const rules = await listEnabledAutoResponseRules(
    context.prisma,
    context.guildId,
    config.maxRules,
  );
  ruleCache.set(context.guildId, { rules, expiresAt: Date.now() + RULE_CACHE_TTL_MS });
  return rules;
}

function isRuleInScope(rule: AutoResponseRuleRecord, message: AutoResponseMessage): boolean {
  if (rule.channelIds.length > 0 && !rule.channelIds.includes(message.channelId)) return false;
  if (rule.roleIds.length === 0) return true;
  const roles = message.member?.roles.cache;
  return Boolean(roles && rule.roleIds.some((roleId) => roles.has(roleId)));
}

function assertBotCanRespond(
  message: AutoResponseMessage,
  responseType: AutoResponseRuleRecord['responseType'],
): void {
  if (message.channel.isTextBased && !message.channel.isTextBased()) {
    throw new Error('AutoResponseChannelNotTextBased');
  }
  const botMember = message.guild?.members.me;
  if (!botMember) throw new Error('AutoResponseBotMemberUnavailable');
  if (!message.channel.permissionsFor) return;
  const permissions = message.channel.permissionsFor(botMember);
  const sendPermission = message.channel.isThread?.()
    ? SEND_MESSAGES_IN_THREADS_PERMISSION
    : SEND_MESSAGES_PERMISSION;
  if (
    !permissions?.has(VIEW_CHANNEL_PERMISSION) ||
    !permissions.has(sendPermission) ||
    (responseType === 'embed' && !permissions.has(EMBED_LINKS_PERMISSION))
  ) {
    throw new Error('AutoResponseBotPermissionDenied');
  }
}

function buildResponse(
  rule: AutoResponseRuleRecord,
  config: AutoResponseConfig,
): AutoResponseSendOptions {
  const allowedMentions = { parse: config.allowUserMentions ? ['users'] : [] };
  if (rule.responseType === 'embed') {
    return {
      embeds: [parseAutoResponseEmbed(rule.responseContent)],
      allowedMentions,
    };
  }
  return { content: rule.responseContent, allowedMentions };
}

async function safelyRecordPreparationFailure(
  context: AutoResponseRuntimeContext,
  input: Parameters<typeof recordPreparationFailureIfDue>[1],
): Promise<boolean> {
  try {
    return await recordPreparationFailureIfDue(context.prisma, input);
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: input.guildId, ruleId: input.ruleId },
      'Auto Response送信準備失敗の間引き記録に失敗しました',
    );
    return false;
  }
}

async function safelyRecordExecution(
  context: AutoResponseRuntimeContext,
  input: Parameters<typeof recordAutoResponseExecution>[1],
): Promise<void> {
  try {
    await recordAutoResponseExecution(context.prisma, input);
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: input.guildId, ruleId: input.ruleId, status: input.status },
      'Auto Response実行メトリクスの記録に失敗しました',
    );
  }
}

function resolveErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  if (error.name.trim() && error.name !== 'Error') return error.name;
  return error.message.trim() || 'Error';
}

export default autoResponsePlugin;
