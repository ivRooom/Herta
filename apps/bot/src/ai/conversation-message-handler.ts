import { resolveAiArtifactIntent, type AiArtifactIntent } from '@herta/plugin-catalog/ai-artifact';
import {
  type AiGroundingState,
  type AiResponseMode,
} from '@herta/plugin-catalog/ai-conversation-policy';
import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import {
  handleAiArtifactMessage,
  isAiArtifactMessageCandidate,
  stripBotMention,
  type AiArtifactDiscordMessage,
  type AiArtifactMessageHandlerOptions,
} from './artifact-message-handler.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

const DISCORD_CONVERSATION_MAX_UTF16_UNITS = 1_900;
const DISCORD_CONVERSATION_INSTRUCTION = [
  'Return only the answer intended for the Discord user.',
  'Keep the final response comfortably below the Discord 2000-character message limit.',
  'Do not claim that retrieval, web access, tools, code execution, or artifact generation happened unless trusted application context confirms it.',
].join(' ');

const EXPLICIT_DETAIL_REQUEST_PATTERN =
  /(?:詳しく|詳細に|丁寧に|手順(?:を)?(?:全部|すべて|全て)|(?:全部|すべて|全て)の?手順|比較して|比較してください|比較を|step[- ]by[- ]step|all\s+(?:the\s+)?steps|compare\b|comparison\b|in\s+detail|detailed)/i;
const EXPLICIT_SOURCE_REQUEST_PATTERN =
  /(?:出典|引用元|citation|citations|source(?:s)?(?!\s+code\b)|ソース(?:を|が|は)?|web\s*検索|ウェブ\s*検索|search\s+(?:the\s+)?web|look\s+up)/i;
const CURRENT_EXTERNAL_FACT_PATTERN =
  /(?:最新|現在の|今の|今日の|本日の).{0,60}(?:状態|状況|価格|料金|バージョン|version|リリース|release|PR|Issue|CI|デプロイ|deploy|稼働|障害|ニュース|天気|株価|為替)|\b(?:latest|current|today(?:'s)?|now)\b.{0,60}\b(?:status|price|pricing|version|release|pull request|issue|ci|deployment|outage|news|weather|stock|exchange rate)\b/i;
const EXTERNAL_TARGET_PATTERN =
  /(?:GitHub|repository|リポジトリ|pull request|\bPR\b|\bIssue\b|\bCI\b|production|本番|deploy|デプロイ|release|リリース|公式(?:ドキュメント|docs?)?|website|サイト|ニュース|天気|株価|為替)/i;
const EXPLICIT_CHECK_PATTERN =
  /(?:確認して|調べて|検索して|検証して|verify\b|check\b|confirm\b|search\b)/i;
const EXTERNAL_STATE_PATTERN =
  /(?:GitHub|repository|リポジトリ|pull request|\bPR\b|\bIssue\b|\bCI\b|production|本番|deploy|デプロイ|release|リリース).{0,80}(?:状態|状況|結果|成功|失敗|merge|merged|open|closed|green|red|何番|version|バージョン)/i;
const URL_PATTERN = /https?:\/\/\S+/i;

export interface AiConversationMessageHandlerOptions extends AiArtifactMessageHandlerOptions {
  generationService: AiRuntimeGenerationService | null;
}

export type AiConversationMessageHandleResult =
  | { status: 'ignored' }
  | {
      status: 'handled';
      intent: AiArtifactIntent;
      responseMode?: AiResponseMode;
      groundingState?: AiGroundingState;
    }
  | { status: 'failed'; category: string };

export async function handleAiConversationMessage(
  message: AiArtifactDiscordMessage,
  options: AiConversationMessageHandlerOptions,
): Promise<AiConversationMessageHandleResult> {
  const botUserId = options.botUserId;
  if (!botUserId || !isAiArtifactMessageCandidate(message, botUserId)) {
    return { status: 'ignored' };
  }

  const input = stripBotMention(message.content, botUserId);
  const pluginConfig = await options.getAiPluginConfig(message.guildId);
  if (!pluginConfig || pluginConfig['enabled'] !== true) return { status: 'ignored' };

  const intent = resolveAiDiscordIntent(input);
  if (intent !== 'chat' && intent !== 'detailed_answer') {
    return handleAiArtifactMessage(message, options);
  }

  if (!options.generationService) return { status: 'ignored' };

  const responseMode: AiResponseMode = intent === 'detailed_answer' ? 'detailed' : 'chat';
  const groundingState = resolveAiConversationGroundingState(input);

  let content: string;
  try {
    const response = await options.generationService.generate({
      feature: 'ai.conversation',
      input,
      guildId: message.guildId,
      scopeGuildId: message.guildId,
      userId: message.author.id,
      authorized: message.member !== null && message.member !== undefined,
      pluginEnabled: true,
      guildOptIn: true,
      responseMode,
      groundingState,
      trustedInstructions: [DISCORD_CONVERSATION_INSTRUCTION],
    });
    content = validateDiscordConversationReply(response.text);
  } catch (error) {
    const safeError =
      error instanceof AiFoundationError ? error : new AiFoundationError('internal_error');
    await message.reply({
      content: safeError.userMessage,
      allowedMentions: { parse: [] },
    });
    return { status: 'failed', category: `foundation:${safeError.category}` };
  }

  // Discord SDK errors can retain request payloads. Delivery happens outside the provider error
  // boundary so a failed send is never converted into a second reply or a false success.
  await message.reply({
    content,
    allowedMentions: { parse: [] },
  });
  return { status: 'handled', intent, responseMode, groundingState };
}

export function resolveAiConversationGroundingState(input: string): AiGroundingState {
  const normalized = typeof input === 'string' ? input.normalize('NFKC').trim() : '';
  if (!normalized) return 'not_required';

  if (
    URL_PATTERN.test(normalized) ||
    EXPLICIT_SOURCE_REQUEST_PATTERN.test(normalized) ||
    CURRENT_EXTERNAL_FACT_PATTERN.test(normalized) ||
    EXTERNAL_STATE_PATTERN.test(normalized) ||
    (EXTERNAL_TARGET_PATTERN.test(normalized) && EXPLICIT_CHECK_PATTERN.test(normalized))
  ) {
    return 'insufficient';
  }

  return 'not_required';
}

function resolveAiDiscordIntent(input: string): AiArtifactIntent {
  const routingInput = input.replace(
    /\b(?:responseMode|groundingState|trustedInstructions)\s*=\s*[^\s,;]+/gi,
    ' ',
  );
  const artifactIntent = resolveAiArtifactIntent(routingInput);
  if (artifactIntent !== 'chat') return artifactIntent;
  return EXPLICIT_DETAIL_REQUEST_PATTERN.test(routingInput) ? 'detailed_answer' : 'chat';
}

function validateDiscordConversationReply(value: string): string {
  if (typeof value !== 'string') throw new AiFoundationError('malformed_response');
  const normalized = value.trim();
  if (normalized.length < 1) throw new AiFoundationError('malformed_response');
  // Discord.js sends JavaScript strings and Discord applies its message limit to the encoded
  // string length. Count UTF-16 code units here so astral characters such as emoji cannot slip
  // past a code-point-only guard and cause delivery failure.
  if (normalized.length > DISCORD_CONVERSATION_MAX_UTF16_UNITS) {
    throw new AiFoundationError('output_too_large');
  }
  return normalized;
}
