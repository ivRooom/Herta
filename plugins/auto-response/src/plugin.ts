import { definePlugin } from '@herta/plugin-sdk';
import type { PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  matchesAutoResponse,
  normalizeAutoResponseConfig,
  parseAutoResponseEmbed,
  type AutoResponseConfig,
} from './config.js';
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
  for (const rule of rules) {
    if (responseCount >= config.maxRulesPerMessage) break;
    if (!isRuleInScope(rule, message)) continue;

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
        errorName: errorName(error),
      });
      context.logger.warn(
        { err: error, guildId: context.guildId, ruleId: rule.id },
        'Auto Responseルールの評価を停止しました',
      );
      continue;
    }
    if (!matched) continue;

    let claimed = false;
    try {
      claimed = await claimAutoResponseRule(context.prisma, {
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

    if (!claimed) {
      await safelyRecordExecution(context, {
        guildId: context.guildId,
        ruleId: rule.id,
        status: 'skipped',
        durationMs: Date.now() - startedAt,
        errorName: null,
      });
      continue;
    }

    try {
      assertBotCanRespond(message);
      await message.channel.send(buildResponse(rule, config));
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
        errorName: errorName(error),
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
  const rules = await listEnabledAutoResponseRules(context.prisma, context.guildId, config.maxRules);
  ruleCache.set(context.guildId, { rules, expiresAt: Date.now() + RULE_CACHE_TTL_MS });
  return rules;
}

function isRuleInScope(rule: AutoResponseRuleRecord, message: AutoResponseMessage): boolean {
  if (rule.channelIds.length > 0 && !rule.channelIds.includes(message.channelId)) return false;
  if (rule.roleIds.length === 0) return true;
  const roles = message.member?.roles.cache;
  return Boolean(roles && rule.roleIds.some((roleId) => roles.has(roleId)));
}

function assertBotCanRespond(message: AutoResponseMessage): void {
  if (message.channel.isTextBased && !message.channel.isTextBased()) {
    throw new Error('AutoResponseChannelNotTextBased');
  }
  const botMember = message.guild?.members.me;
  if (!botMember) throw new Error('AutoResponseBotMemberUnavailable');
  if (!message.channel.permissionsFor) return;
  const permissions = message.channel.permissionsFor(botMember);
  if (
    !permissions?.has(VIEW_CHANNEL_PERMISSION) ||
    !permissions.has(SEND_MESSAGES_PERMISSION)
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

function errorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'UnknownError';
}

export default autoResponsePlugin;
