import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import { AiArtifactRuntime, AiArtifactRuntimeError } from './artifact-runtime.js';
import {
  deliverDiscordArtifacts,
  type DiscordArtifactReplyOptions,
} from './discord-artifact-delivery.js';

export interface AiArtifactDiscordMessage {
  guildId: string | null;
  content: string;
  webhookId?: string | null;
  author: { id: string; bot?: boolean };
  member?: unknown | null;
  mentions: { users: { has(userId: string): boolean } };
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

export async function handleAiArtifactMessage(
  message: AiArtifactDiscordMessage,
  options: AiArtifactMessageHandlerOptions,
): Promise<AiArtifactMessageHandleResult> {
  if (
    !options.runtime ||
    !options.botUserId ||
    !message.guildId ||
    message.author.bot ||
    message.webhookId ||
    !message.mentions.users.has(options.botUserId)
  ) {
    return { status: 'ignored' };
  }

  const input = stripBotMention(message.content, options.botUserId);
  if (!input) return { status: 'ignored' };

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

  // Success wording is created only here, from already validated artifact metadata.
  // If Discord delivery itself fails, let the caller observe/log that failure rather than
  // sending a second message that could incorrectly describe the attachment state.
  await deliverDiscordArtifacts(message, result.artifacts);
  return { status: 'handled', intent: result.intent };
}

export function stripBotMention(content: string, botUserId: string): string {
  if (typeof content !== 'string' || !/^\d+$/.test(botUserId)) return '';
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSafeArtifactMessageError(error: unknown): { category: string; userMessage: string } {
  if (error instanceof AiFoundationError) {
    return { category: `foundation:${error.category}`, userMessage: error.userMessage };
  }
  if (error instanceof AiArtifactRuntimeError) {
    return { category: `artifact:${error.category}`, userMessage: error.userMessage };
  }
  return { category: 'internal_error', userMessage: '成果物の生成中にエラーが発生しました。' };
}
