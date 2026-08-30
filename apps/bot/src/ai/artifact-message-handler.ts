import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import { AiArtifactRuntime, AiArtifactRuntimeError } from './artifact-runtime.js';
import { AiCodeExecutionError } from './code-execution-service.js';
import { AiImageGenerationError } from './image-generation-service.js';
import {
  buildExecutionTextSummary,
  deliverDiscordArtifacts,
  deliverDiscordExecutionArtifacts,
  type DiscordArtifactReplyOptions,
} from './discord-artifact-delivery.js';

const verifiedBotReplyMessages = new WeakSet<object>();

export interface AiReferencedDiscordMessage {
  guildId?: string | null;
  author: { id: string };
}

export interface AiArtifactDiscordMessage {
  guildId: string | null;
  content: string;
  webhookId?: string | null;
  author: { id: string; bot?: boolean };
  member?: unknown | null;
  mentions: { users: { has(userId: string): boolean } };
  reference?: { messageId?: string | null } | null;
  fetchReference?(): Promise<AiReferencedDiscordMessage>;
  reply(options: DiscordArtifactReplyOptions | DiscordSafeTextReplyOptions): Promise<unknown>;
}

export interface DiscordSafeTextReplyOptions {
  content: string;
  allowedMentions: { parse: [] };
}

export interface AiArtifactMessageHandlerOptions {
  runtime: AiArtifactRuntime | null;
  botUserId: string | null;
  getAiPluginConfig(guildId: string): Promise<Record<string, unknown> | null>;
}

export type AiArtifactMessageHandleResult =
  | { status: 'ignored' }
  | {
      status: 'handled';
      intent: 'code_artifact' | 'file_artifact' | 'code_execution' | 'image_generation';
    }
  | { status: 'failed'; category: string };

type AiArtifactCandidateMessage = AiArtifactDiscordMessage & { guildId: string };

export async function handleAiArtifactMessage(
  message: AiArtifactDiscordMessage,
  options: AiArtifactMessageHandlerOptions,
): Promise<AiArtifactMessageHandleResult> {
  const botUserId = options.botUserId;
  if (!options.runtime || !botUserId || !isAiArtifactMessageCandidate(message, botUserId)) {
    return { status: 'ignored' };
  }

  const input = stripBotMention(message.content, botUserId);

  const pluginConfig = await options.getAiPluginConfig(message.guildId);
  if (!pluginConfig || pluginConfig['enabled'] !== true) return { status: 'ignored' };

  let result;
  try {
    result = await options.runtime.prepare({
      input,
      guildId: message.guildId,
      scopeGuildId: message.guildId,
      userId: message.author.id,
      authorized: message.member !== null && message.member !== undefined,
      pluginEnabled: true,
      guildOptIn: true,
    });
  } catch (error) {
    const safeError = toSafeArtifactMessageError(error);
    await message.reply({
      content: safeError.userMessage,
      allowedMentions: { parse: [] },
    });
    return { status: 'failed', category: safeError.category };
  }

  if (result.status === 'not_handled') return { status: 'ignored' };
  if (result.status === 'unsupported') {
    await message.reply({
      content: result.userMessage,
      allowedMentions: { parse: [] },
    });
    return { status: 'handled', intent: result.intent };
  }

  if (result.status === 'executed') {
    if (result.artifacts.length > 0) {
      await deliverDiscordExecutionArtifacts(message, result.summary, result.artifacts);
    } else {
      await message.reply({
        content: buildExecutionTextSummary(result.summary),
        allowedMentions: { parse: [] },
      });
    }
    return { status: 'handled', intent: 'code_execution' };
  }

  // Success wording is created only here, from already validated artifact metadata.
  // If Discord delivery itself fails, let the caller observe/log that failure rather than
  // sending a second message that could incorrectly describe the attachment state.
  await deliverDiscordArtifacts(message, result.artifacts);
  return { status: 'handled', intent: result.intent };
}

/**
 * A Discord message is an AI candidate only when it is a safe Guild user message and either
 * contains a real mention of the running Herta Bot or has already been verified as a direct reply
 * to a message authored by that Bot.
 */
export function isAiArtifactMessageCandidate(
  message: AiArtifactDiscordMessage | undefined,
  botUserId: string | null,
): message is AiArtifactCandidateMessage {
  if (!botUserId || !isSafeAiMessageBase(message, botUserId)) return false;

  const hasRealMention =
    message.mentions.users.has(botUserId) && hasBotMentionInContent(message.content, botUserId);
  const isVerifiedBotReply = verifiedBotReplyMessages.has(message);

  return Boolean(
    (hasRealMention || isVerifiedBotReply) && stripBotMention(message.content, botUserId),
  );
}

/**
 * Discord reply metadata alone is not trusted. Fetch the referenced message and only mark this
 * message as an AI candidate when the referenced author is the currently running Herta Bot.
 * Fetch failures are a normal ignore path and the raw Discord error is deliberately discarded.
 */
export async function verifyAiReplyToBot(
  message: AiArtifactDiscordMessage | undefined,
  botUserId: string | null,
): Promise<boolean> {
  if (!isSafeAiMessageBase(message, botUserId)) return false;
  if (!message.reference?.messageId || typeof message.fetchReference !== 'function') return false;

  try {
    const referenced = await message.fetchReference();
    if (referenced.author.id !== botUserId) return false;
    if (referenced.guildId && referenced.guildId !== message.guildId) return false;
    verifiedBotReplyMessages.add(message);
    return true;
  } catch {
    return false;
  }
}

export function stripBotMention(content: string, botUserId: string): string {
  if (typeof content !== 'string' || !/^\d+$/.test(botUserId)) return '';
  return content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), ' ').trim();
}

function isSafeAiMessageBase(
  message: AiArtifactDiscordMessage | undefined,
  botUserId: string | null,
): message is AiArtifactCandidateMessage {
  return Boolean(
    message &&
    botUserId &&
    /^\d+$/.test(botUserId) &&
    message.guildId &&
    message.author.id !== botUserId &&
    !message.author.bot &&
    !message.webhookId &&
    typeof message.content === 'string' &&
    message.content.trim(),
  );
}

function hasBotMentionInContent(content: string, botUserId: string): boolean {
  if (typeof content !== 'string' || !/^\d+$/.test(botUserId)) return false;
  return content.includes(`<@${botUserId}>`) || content.includes(`<@!${botUserId}>`);
}

function toSafeArtifactMessageError(error: unknown): { category: string; userMessage: string } {
  if (error instanceof AiFoundationError) {
    return { category: `foundation:${error.category}`, userMessage: error.userMessage };
  }
  if (error instanceof AiCodeExecutionError) {
    return { category: `execution:${error.category}`, userMessage: error.userMessage };
  }
  if (error instanceof AiImageGenerationError) {
    return { category: `image_generation:${error.category}`, userMessage: error.userMessage };
  }
  if (error instanceof AiArtifactRuntimeError) {
    return { category: `artifact:${error.category}`, userMessage: error.userMessage };
  }
  return { category: 'internal_error', userMessage: '成果物の生成中にエラーが発生しました。' };
}
