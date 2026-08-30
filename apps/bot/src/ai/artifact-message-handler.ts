import { createHash } from 'node:crypto';
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

const AI_CONVERSATION_FOLLOW_UP_TTL_MS = 5 * 60 * 1_000;
const AI_CONVERSATION_FOLLOW_UP_MAX_ENTRIES = 1_000;
const verifiedBotReplyMessages = new WeakSet<object>();
const conversationFollowUps = new Map<string, number>();

export interface AiReferencedDiscordMessage {
  guildId?: string | null;
  author: { id: string };
}

export interface AiArtifactDiscordMessage {
  guildId: string | null;
  channelId?: string | null;
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
 * A user can start AI conversation with a real Herta mention, continue by directly replying to a
 * Herta message after server-side verification, or keep chatting briefly in the same user/channel
 * follow-up window. The latter is intentionally bounded so Herta does not start consuming normal
 * channel traffic indefinitely.
 */
export function isAiArtifactMessageCandidate(
  message: AiArtifactDiscordMessage | undefined,
  botUserId: string | null,
  nowMs = Date.now(),
): message is AiArtifactCandidateMessage {
  if (!isSafeAiMessageBase(message, botUserId)) return false;

  const hasRealMention =
    message.mentions.users.has(botUserId) && hasBotMentionInContent(message.content, botUserId);
  const isVerifiedBotReply = verifiedBotReplyMessages.has(message);
  const isFollowUp = hasActiveAiConversationFollowUp(message, nowMs);

  return Boolean(
    (hasRealMention || isVerifiedBotReply || isFollowUp) &&
    stripBotMention(message.content, botUserId),
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

/** Start or refresh the bounded no-mention follow-up window after a successful AI chat reply. */
export function activateAiConversationFollowUp(
  message: AiArtifactDiscordMessage,
  nowMs = Date.now(),
): void {
  const key = aiConversationFollowUpKey(message);
  if (!key) return;

  pruneExpiredAiConversationFollowUps(nowMs);
  if (conversationFollowUps.size >= AI_CONVERSATION_FOLLOW_UP_MAX_ENTRIES) {
    const oldestKey = conversationFollowUps.keys().next().value as string | undefined;
    if (oldestKey) conversationFollowUps.delete(oldestKey);
  }
  conversationFollowUps.delete(key);
  conversationFollowUps.set(key, nowMs + AI_CONVERSATION_FOLLOW_UP_TTL_MS);
}

/** Used when the shared AI runtime is shut down and by deterministic tests. */
export function clearAiConversationFollowUps(): void {
  conversationFollowUps.clear();
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

function hasActiveAiConversationFollowUp(
  message: AiArtifactDiscordMessage,
  nowMs: number,
): boolean {
  const key = aiConversationFollowUpKey(message);
  if (!key) return false;
  const expiresAt = conversationFollowUps.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= nowMs) {
    conversationFollowUps.delete(key);
    return false;
  }
  return true;
}

function aiConversationFollowUpKey(message: AiArtifactDiscordMessage): string | null {
  const guildId = message.guildId?.trim();
  const channelId = message.channelId?.trim();
  const userId = message.author.id?.trim();
  if (!guildId || !channelId || !userId) return null;
  return createHash('sha256')
    .update(`${guildId}\u0000${channelId}\u0000${userId}`)
    .digest('hex')
    .slice(0, 32);
}

function pruneExpiredAiConversationFollowUps(nowMs: number): void {
  for (const [key, expiresAt] of conversationFollowUps) {
    if (expiresAt <= nowMs) conversationFollowUps.delete(key);
  }
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
