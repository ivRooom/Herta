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
const INSUFFICIENT_GROUNDING_ARTIFACT_REPLY =
  'この依頼には外部情報の確認が必要ですが、現在は参照できません。成果物は作成していません。';

const EXPLICIT_DETAIL_REQUEST_PATTERN =
  /(?:詳しく|詳細に|丁寧に|手順(?:を)?(?:全部|すべて|全て)|(?:全部|すべて|全て)の?手順|比較して|比較してください|比較を|step[- ]by[- ]step|all\s+(?:the\s+)?steps|compare\b|comparison\b|in\s+detail|detailed)/i;
const EXPLICIT_SOURCE_REQUEST_PATTERN =
  /(?:出典|引用元|citation|citations|source(?:s)?(?!\s+code\b)|ソース(?!コード)(?:を|が|は)?|web\s*検索|ウェブ\s*検索|search\s+(?:the\s+)?web|look\s+up)/i;
const CURRENT_EXTERNAL_FACT_PATTERN =
  /(?:最新|現在の|今の|今日の|本日の).{0,60}(?:状態|状況|価格|料金|バージョン|version|リリース|release|PR|Issue|CI|デプロイ|deploy|稼働|障害|ニュース|天気|株価|為替)|(?:状態|状況|価格|料金|バージョン|リリース|PR|Issue|CI|デプロイ|稼働|障害|ニュース|天気|株価|為替).{0,60}(?:最新|現在|今|今日|本日)|\b(?:latest|current|today(?:'s)?|now)\b.{0,60}\b(?:status|price|pricing|version|release|pull request|issue|ci|deployment|outage|news|weather|stock|exchange rate)\b|\b(?:status|price|pricing|version|release|pull request|issue|ci|deployment|outage|news|weather|stock|exchange rate)\b.{0,60}\b(?:latest|current|today(?:'s)?|now)\b/i;
const CURRENT_REQUEST_MARKER_PATTERN =
  /(?:最新|今日|本日|今(?!後)|現在の)|\b(?:latest|today(?:'s)?|now|current)\b/i;
const CURRENT_REQUEST_FACT_PATTERN =
  /(?:[?？]|教えて|知りたい|誰|何|いつ|どこ|いくら|何時|結果|スコア|状態|状況|\b(?:tell me|show me|give me|who|what|when|where|which|how much|how many|score|time)\b)/i;
const EVERGREEN_CURRENT_CONCEPT_PATTERN =
  /(?:\b(?:what does|what is|define|explain)\s+(?:electric\s+|electrical\s+)?current\b|\b(?:electric|electrical|alternating|direct)\s+current\b|\bcurrent\s+(?:flow|density|source|mirror|loop|operator|keyword|concept|term)\b)/i;
const LIVE_EXTERNAL_QUERY_PATTERN =
  /(?:天気|天候|株価|為替|ニュース|障害状況)(?:は|って)?(?:どう(?!やって|して|いう)|いくら|何円|教えて|を教えて|見せて|[?？])|\b(?:what(?:'s| is)|how(?:'s| is))\s+the\s+(?:weather|forecast|stock price|exchange rate|news|outage status)(?:\s+(?:in|for|at|of)\s+[^?]+)?\s*\?|\b(?:weather|forecast|stock price|exchange rate|outage status)(?:\s+(?:in|for|at|of)\s+[^?]+)?\s*\?/i;
const EXTERNAL_TARGET_PATTERN =
  /(?:GitHub|repository|リポジトリ|pull request|\bPR\b|\bIssue\b|\bCI\b|production|本番|deploy|デプロイ|release|リリース|公式(?:ドキュメント|docs?)?|website|サイト|ニュース|天気|株価|為替)/i;
const EXPLICIT_CHECK_PATTERN =
  /(?:確認して|調べて|検索して|検証して|verify\b|check\b|confirm\b|search\b)/i;
const EXTERNAL_STATE_PATTERN =
  /(?:GitHub|repository|リポジトリ|production|本番|deploy|デプロイ|release|リリース).{0,80}(?:状態|状況|結果|成功|失敗|稼働|障害|何番)|(?:pull request|\bPR\b|\bIssue\b|\bCI\b).{0,80}(?:状態|状況|結果|成功|失敗|\b(?:merged|open|closed|green|red)\b|何番)/i;
const URL_PATTERN = /https?:\/\/\S+/i;
const URL_DEREFERENCE_PATTERN =
  /(?:https?:\/\/\S+.{0,80}(?:を元に|をもとに|の内容(?:を|について)?|を開いて|を読んで|を取得して|を要約して|を解析して)|(?:を元に|をもとに|内容を|開いて|読んで|取得して|要約して|解析して|\bbased on\b|\busing\b|\bfrom\b|\bread\b|\bopen\b|\bvisit\b|\bfetch\b|\bsummarize\b|\banaly[sz]e\b).{0,80}https?:\/\/\S+)/i;

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
  const groundingState = resolveAiConversationGroundingState(input);
  if (intent !== 'chat' && intent !== 'detailed_answer') {
    if (groundingState === 'insufficient') {
      await message.reply({
        content: INSUFFICIENT_GROUNDING_ARTIFACT_REPLY,
        allowedMentions: { parse: [] },
      });
      return { status: 'failed', category: 'grounding:insufficient' };
    }
    return handleAiArtifactMessage(message, options);
  }

  if (!options.generationService) return { status: 'ignored' };

  const responseMode: AiResponseMode = intent === 'detailed_answer' ? 'detailed' : 'chat';

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

  const requiresCurrentGrounding =
    CURRENT_REQUEST_MARKER_PATTERN.test(normalized) &&
    CURRENT_REQUEST_FACT_PATTERN.test(normalized) &&
    !EVERGREEN_CURRENT_CONCEPT_PATTERN.test(normalized);
  const requiresUrlGrounding =
    URL_PATTERN.test(normalized) && URL_DEREFERENCE_PATTERN.test(normalized);

  if (
    requiresUrlGrounding ||
    EXPLICIT_SOURCE_REQUEST_PATTERN.test(normalized) ||
    CURRENT_EXTERNAL_FACT_PATTERN.test(normalized) ||
    requiresCurrentGrounding ||
    LIVE_EXTERNAL_QUERY_PATTERN.test(normalized) ||
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
