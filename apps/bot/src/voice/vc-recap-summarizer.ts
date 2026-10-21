import type { PrismaClient, VcRecapTranscriptSegmentRecord } from '@herta/db';
import { getGuildMonthlyAiSpendUsd, recordAiGenerationEvent } from '@herta/db';
import {
  estimateOpenAiCostMicroUsd,
  resolveAiFoundationConfig,
  resolveAiGuildMonthlyBudgetUsd,
  type AiOpenAiModel,
} from '@herta/plugin-catalog/ai-service';
import { resolveAiOpenAiCredential } from '../ai/factory.js';

/**
 * VC要約の生成は既存のAiFoundationService(チャット機能向けのguild opt-in・ガード・
 * レート制限・テレメトリと密結合)には相乗りせず、credential解決だけを再利用した
 * 軽量な直接OpenAI呼び出しで行う(docs/RAG_ROADMAP.md Phase 2参照)。
 */
const SUMMARY_MODEL: AiOpenAiModel = 'gpt-5.6-luna';
const SUMMARY_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 600;
const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_TOPICS = 10;

export interface VcRecapSummaryResult {
  summary: string;
  topics: string[];
}

function buildPrompt(segments: readonly VcRecapTranscriptSegmentRecord[]): string {
  const transcript = segments
    .map((segment) => `[${segment.userId}] ${segment.text}`)
    .join('\n')
    .slice(0, MAX_TRANSCRIPT_CHARS);

  return [
    '以下はDiscordのボイスチャンネルでの会話の文字起こしです。',
    '会話全体を3〜5行程度で簡潔に要約し、話題のキーワードを3〜5個挙げてください。',
    '出力は次のJSON形式のみを返してください(前後に説明文やコードブロックは付けないこと):',
    '{"summary": "...", "topics": ["...", "..."]}',
    '',
    transcript,
  ].join('\n');
}

function parseSummaryJson(text: string): VcRecapSummaryResult | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
    const parsed = JSON.parse(cleaned) as { summary?: unknown; topics?: unknown };
    if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) return null;
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics
          .filter((topic): topic is string => typeof topic === 'string')
          .slice(0, MAX_TOPICS)
      : [];
    return { summary: parsed.summary.trim().slice(0, MAX_SUMMARY_CHARS), topics };
  } catch {
    return null;
  }
}

function extractUsage(payload: unknown): { inputTokens: number; outputTokens: number } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const usage = (payload as Record<string, unknown>)['usage'];
  if (typeof usage !== 'object' || usage === null) return null;
  const inputTokens = (usage as Record<string, unknown>)['input_tokens'];
  const outputTokens = (usage as Record<string, unknown>)['output_tokens'];
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null;
  return { inputTokens: Math.max(0, inputTokens), outputTokens: Math.max(0, outputTokens) };
}

function extractOutputText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const output = (payload as Record<string, unknown>)['output'];
  if (!Array.isArray(output)) return null;

  const texts: string[] = [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    if ((item as Record<string, unknown>)['type'] !== 'message') continue;
    const content = (item as Record<string, unknown>)['content'];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const partRecord = part as Record<string, unknown>;
      if (partRecord['type'] === 'output_text' && typeof partRecord['text'] === 'string') {
        texts.push(partRecord['text']);
      }
    }
  }
  const text = texts.join('').trim();
  return text || null;
}

/**
 * segmentsが空、OpenAI credentialが未設定、Guild月次AI予算上限超過、API呼び出しが失敗
 * (タイムアウト含む)、応答の解析に失敗した場合はnullを返す(呼び出し元はfailVcRecapSessionで
 * 記録する)。
 */
export async function summarizeVcRecapSession(
  prisma: PrismaClient,
  guildId: string,
  segments: readonly VcRecapTranscriptSegmentRecord[],
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<VcRecapSummaryResult | null> {
  if (segments.length === 0) return null;

  // .env.exampleが約束する「HERTA_AI_KILL_SWITCHが有効ならguild設定に関係なくproviderを
  // 呼ばない」という緊急停止契約は、VC要約の独立したOpenAI呼び出しにも適用する
  // (resolveAiOpenAiCredentialはcredential解決のみでkill switchを見ないため、別途確認する)。
  let aiEnabled: boolean;
  let guildMonthlyBudgetUsd = 0;
  try {
    const baseConfig = resolveAiFoundationConfig(env);
    aiEnabled = baseConfig.enabled && !baseConfig.killSwitch;
    guildMonthlyBudgetUsd = resolveAiGuildMonthlyBudgetUsd(env);
  } catch {
    aiEnabled = false;
  }
  if (!aiEnabled) return null;

  // Issue #519: チャットAI側(AiFoundationService経路)と同じGuild月次予算を共有する。
  // DB照会が失敗した場合はfail-open(要約自体は続行)し、一時的なDB障害でVC Recapが
  // 止まらないようにする。
  if (guildMonthlyBudgetUsd > 0) {
    const spentUsd = await getGuildMonthlyAiSpendUsd(prisma, guildId).catch(() => 0);
    if (spentUsd >= guildMonthlyBudgetUsd) return null;
  }

  const credential = await resolveAiOpenAiCredential({ prisma, env });
  if (!credential.apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        input: buildPrompt(segments),
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const payload = await response.json();
    await recordVcRecapSummaryCost(prisma, guildId, payload, Date.now() - startedAt);
    const text = extractOutputText(payload);
    if (!text) return null;
    return parseSummaryJson(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * VC要約の呼び出しもai_generation_eventsへ記録し、チャットAIと同じGuild月次予算の
 * 対象に含める(Issue #519)。記録失敗は要約結果に影響させない(fire-and-forget)。
 */
async function recordVcRecapSummaryCost(
  prisma: PrismaClient,
  guildId: string,
  payload: unknown,
  durationMs: number,
): Promise<void> {
  const usage = extractUsage(payload);
  if (!usage) return;
  const estimatedCostUsd =
    estimateOpenAiCostMicroUsd(SUMMARY_MODEL, usage.inputTokens, usage.outputTokens) / 1_000_000;
  await recordAiGenerationEvent(prisma, {
    guildId,
    provider: 'openai',
    model: SUMMARY_MODEL,
    modelProfile: 'vc_recap_summary',
    feature: 'vc_recap_summary',
    resultCategory: 'success',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    estimatedCostUsd,
    durationMs,
  }).catch(() => undefined);
}
