import { isDiscordGuildId } from './guild-context-nav.ts';
import {
  STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH,
  STUDIO_COMMAND_SEARCH_RESULT_LIMIT,
  type StudioCommandItem,
} from './studio-navigation.ts';

export const STUDIO_COMMAND_SEMANTIC_SCORE_THRESHOLD = 0.42;
export const STUDIO_COMMAND_SEMANTIC_QUERY_MIN_LENGTH = 2;

export type StudioCommandSemanticMode = 'disabled' | 'semantic' | 'fallback';

export interface StudioCommandSemanticScore {
  id: string;
  score: number;
}

export interface StudioCommandSemanticResponse {
  mode: StudioCommandSemanticMode;
  scores: StudioCommandSemanticScore[];
}

export interface StudioCommandSemanticDocument {
  id: string;
  text: string;
}

export interface StudioCommandSemanticRequest {
  query: string;
  guildId: string | null;
}

export function parseStudioCommandSemanticRequest(
  value: unknown,
): StudioCommandSemanticRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.query !== 'string') return null;

  const query = record.query.slice(0, STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH).trim();
  if (query.length < STUDIO_COMMAND_SEMANTIC_QUERY_MIN_LENGTH) return null;

  const guildId = record.guildId;
  if (guildId === null || guildId === undefined || guildId === '') {
    return { query, guildId: null };
  }
  if (typeof guildId !== 'string' || !isDiscordGuildId(guildId)) return null;

  return { query, guildId };
}

export function parseStudioCommandSemanticResponse(value: unknown): StudioCommandSemanticResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { mode: 'fallback', scores: [] };
  }

  const record = value as Record<string, unknown>;
  const mode = isSemanticMode(record.mode) ? record.mode : 'fallback';
  if (mode !== 'semantic' || !Array.isArray(record.scores)) return { mode, scores: [] };

  const scores: StudioCommandSemanticScore[] = [];
  for (const candidate of record.scores.slice(0, STUDIO_COMMAND_SEARCH_RESULT_LIMIT)) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
    const scoreRecord = candidate as Record<string, unknown>;
    if (typeof scoreRecord.id !== 'string' || scoreRecord.id.length < 1 || scoreRecord.id.length > 100) {
      continue;
    }
    if (
      typeof scoreRecord.score !== 'number' ||
      !Number.isFinite(scoreRecord.score) ||
      scoreRecord.score < 0 ||
      scoreRecord.score > 1
    ) {
      continue;
    }
    scores.push({ id: scoreRecord.id, score: scoreRecord.score });
  }

  return { mode, scores };
}

export function buildStudioCommandSemanticDocuments(
  items: readonly StudioCommandItem[],
): StudioCommandSemanticDocument[] {
  return items.map((item) => ({
    id: item.id,
    text: [
      `label: ${item.label}`,
      `keywords: ${item.keywords.join(' | ')}`,
      `intents: ${(item.intents ?? []).join(' | ')}`,
      `group: ${item.group}`,
      `route: ${sanitizeStudioCommandRoute(item.href)}`,
    ].join('\n'),
  }));
}

export function mergeStudioCommandSearchResults(
  items: readonly StudioCommandItem[],
  lexicalResults: readonly StudioCommandItem[],
  semanticScores: readonly StudioCommandSemanticScore[],
): StudioCommandItem[] {
  if (lexicalResults.length >= STUDIO_COMMAND_SEARCH_RESULT_LIMIT) {
    return lexicalResults.slice(0, STUDIO_COMMAND_SEARCH_RESULT_LIMIT);
  }

  const lexicalIds = new Set(lexicalResults.map((item) => item.id));
  const itemIndex = new Map(items.map((item, index) => [item.id, { item, index }]));
  const bestSemanticScore = new Map<string, number>();

  for (const candidate of semanticScores) {
    if (!Number.isFinite(candidate.score) || candidate.score < STUDIO_COMMAND_SEMANTIC_SCORE_THRESHOLD) {
      continue;
    }
    if (candidate.score > 1 || lexicalIds.has(candidate.id) || !itemIndex.has(candidate.id)) continue;
    const current = bestSemanticScore.get(candidate.id) ?? -1;
    if (candidate.score > current) bestSemanticScore.set(candidate.id, candidate.score);
  }

  const semanticOnly = [...bestSemanticScore.entries()]
    .map(([id, score]) => {
      const resolved = itemIndex.get(id);
      return resolved ? { ...resolved, score } : null;
    })
    .filter((entry): entry is { item: StudioCommandItem; index: number; score: number } => entry !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);

  return [...lexicalResults, ...semanticOnly].slice(0, STUDIO_COMMAND_SEARCH_RESULT_LIMIT);
}

function sanitizeStudioCommandRoute(href: string): string {
  return href.replace(/\/dashboard\/guilds\/\d{17,20}/u, '/dashboard/guilds/{guildId}');
}

function isSemanticMode(value: unknown): value is StudioCommandSemanticMode {
  return value === 'disabled' || value === 'semantic' || value === 'fallback';
}
