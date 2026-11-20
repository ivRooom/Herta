import { createHmac, randomUUID } from 'node:crypto';

export const QUEST_BOARD_PATH = '/v2/herta/quest-board';
export const QUEST_BOARD_PURPOSE = 'herta-quest-board-v2';

/**
 * The status action returns the member's whole board (three periods,
 * at most 22 quests plus the recent history). The cap follows the
 * game-accounts client's 64 KiB: a board larger than this is treated
 * as an upstream malfunction, not parsed.
 */
const MAX_RESPONSE_BYTES = 65_536;

const REQUEST_TIMEOUT_MS = 5_000;

export interface QuestBoardConfig {
  apiBaseUrl: string;
  secret: string;
  guildId: string;
}

export type QuestBoardPeriodType = 'daily' | 'weekly' | 'monthly';

export const QUEST_BOARD_PERIOD_TYPES: readonly QuestBoardPeriodType[] = [
  'daily',
  'weekly',
  'monthly',
];

/**
 * One quest on the member's board, in the exact shape the API's
 * QuestBoardStatus read model serves (ivrm-web
 * points/quest-board-status.ts). Progress is derived server-side at
 * read time, so what the bot renders can never drift from the portal.
 */
export interface QuestBoardQuest {
  key: string;
  title: string;
  description: string;
  category: string;
  signalKey: string;
  threshold: number;
  unit: string;
  xpReward: number;
  prerequisiteQuestKey: string | null;
  prerequisiteTitle: string | null;
  locked: boolean;
  progress: number;
  completed: boolean;
  /** Whether the completion (and its XP grant) is already recorded. */
  recorded: boolean;
}

export interface QuestBoardPeriod {
  periodType: QuestBoardPeriodType;
  periodKey: string;
  startSlotDate: string;
  endSlotDate: string;
  /** UTC instant the period closes (exclusive). */
  endsAt: string;
  /** Points the all-clear bonus pays for this period. */
  allClearPoints: number;
  quests: QuestBoardQuest[];
  completedCount: number;
  allClear: boolean;
}

export interface QuestBoardHistoryEntry {
  questKey: string;
  title: string | null;
  category: string | null;
  unit: string | null;
  period: QuestBoardPeriodType;
  periodKey: string;
  progressSnapshot: number;
  signalKey: string;
  xpReward: number;
  completedAt: string;
}

export interface QuestBoardStatus {
  periods: QuestBoardPeriod[];
  totalCompletions: number;
  completionsByPeriod: Record<QuestBoardPeriodType, number>;
  history: QuestBoardHistoryEntry[];
}

export type IvrmQuestBoardResult =
  | { status: 'ok'; board: QuestBoardStatus }
  | { status: 'not-linked' }
  | { status: 'duplicate' }
  | { status: 'disabled' }
  | { status: 'ineligible-guild' | 'unavailable' | 'unconfigured' };

export function resolveQuestBoardConfig(
  env: Partial<Record<string, string | undefined>>,
): QuestBoardConfig | null {
  const raw = env.IVRM_WEB_API_BASE_URL?.trim();
  const secret = env.HERTA_MBTI_SYNC_SECRET?.trim();
  if (!raw || !secret) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      return null;
    const guildId = env.IVRM_INTEGRATION_GUILD_ID?.trim();
    if (!guildId || !/^\d{17,20}$/.test(guildId)) return null;
    return { apiBaseUrl: url.origin, secret, guildId };
  } catch {
    return null;
  }
}

/**
 * Builds the signed status request. The wire contract mirrors the
 * game-accounts integration with a quest-board purpose string, so a
 * signature minted for another integration is never accepted here
 * (and vice versa). Q2 only ever sends the status action; the card
 * action lands with Q3.
 */
export function buildQuestBoardRequest(
  config: QuestBoardConfig,
  guildId: string,
  userId: string,
  requestId: string,
  timestamp: string,
) {
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    requestId,
    guildId,
    discordUserId: userId,
    action: 'status',
  };
  const body = JSON.stringify(payload);
  const key = createHmac('sha256', config.secret).update(QUEST_BOARD_PURPOSE).digest();
  const signature = createHmac('sha256', key)
    .update(['POST', QUEST_BOARD_PATH, timestamp, requestId, body].join('\n'))
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${QUEST_BOARD_PATH}`,
    init: {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-IVRM-Timestamp': timestamp,
        'X-IVRM-Event-Id': requestId,
        'X-IVRM-Signature': signature,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPeriodType(value: unknown): value is QuestBoardPeriodType {
  return (
    typeof value === 'string' && (QUEST_BOARD_PERIOD_TYPES as readonly string[]).includes(value)
  );
}

function parseQuest(value: unknown): QuestBoardQuest | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.key !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.category !== 'string' ||
    typeof value.signalKey !== 'string' ||
    !isFiniteNumber(value.threshold) ||
    typeof value.unit !== 'string' ||
    !isFiniteNumber(value.xpReward) ||
    !isStringOrNull(value.prerequisiteQuestKey) ||
    !isStringOrNull(value.prerequisiteTitle) ||
    typeof value.locked !== 'boolean' ||
    !isFiniteNumber(value.progress) ||
    typeof value.completed !== 'boolean' ||
    typeof value.recorded !== 'boolean'
  )
    return undefined;
  return {
    key: value.key,
    title: value.title,
    description: value.description,
    category: value.category,
    signalKey: value.signalKey,
    threshold: value.threshold,
    unit: value.unit,
    xpReward: value.xpReward,
    prerequisiteQuestKey: value.prerequisiteQuestKey,
    prerequisiteTitle: value.prerequisiteTitle,
    locked: value.locked,
    progress: value.progress,
    completed: value.completed,
    recorded: value.recorded,
  };
}

function parsePeriod(value: unknown): QuestBoardPeriod | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isPeriodType(value.periodType) ||
    typeof value.periodKey !== 'string' ||
    typeof value.startSlotDate !== 'string' ||
    typeof value.endSlotDate !== 'string' ||
    typeof value.endsAt !== 'string' ||
    !isFiniteNumber(value.allClearPoints) ||
    !Array.isArray(value.quests) ||
    !isFiniteNumber(value.completedCount) ||
    typeof value.allClear !== 'boolean'
  )
    return undefined;
  const quests: QuestBoardQuest[] = [];
  for (const entry of value.quests) {
    const quest = parseQuest(entry);
    if (!quest) return undefined;
    quests.push(quest);
  }
  return {
    periodType: value.periodType,
    periodKey: value.periodKey,
    startSlotDate: value.startSlotDate,
    endSlotDate: value.endSlotDate,
    endsAt: value.endsAt,
    allClearPoints: value.allClearPoints,
    quests,
    completedCount: value.completedCount,
    allClear: value.allClear,
  };
}

function parseHistoryEntry(value: unknown): QuestBoardHistoryEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.questKey !== 'string' ||
    !isStringOrNull(value.title) ||
    !isStringOrNull(value.category) ||
    !isStringOrNull(value.unit) ||
    !isPeriodType(value.period) ||
    typeof value.periodKey !== 'string' ||
    !isFiniteNumber(value.progressSnapshot) ||
    typeof value.signalKey !== 'string' ||
    !isFiniteNumber(value.xpReward) ||
    typeof value.completedAt !== 'string'
  )
    return undefined;
  return {
    questKey: value.questKey,
    title: value.title,
    category: value.category,
    unit: value.unit,
    period: value.period,
    periodKey: value.periodKey,
    progressSnapshot: value.progressSnapshot,
    signalKey: value.signalKey,
    xpReward: value.xpReward,
    completedAt: value.completedAt,
  };
}

/**
 * Validates the board the API returns. The board is only well-formed
 * when it carries each period exactly once; anything else is an
 * upstream malfunction and fails closed like every other field here.
 */
function parseQuestBoardStatus(value: unknown): QuestBoardStatus | undefined {
  if (!isRecord(value)) return undefined;
  if (!Array.isArray(value.periods)) return undefined;
  const periods: QuestBoardPeriod[] = [];
  const seen = new Set<QuestBoardPeriodType>();
  for (const entry of value.periods) {
    const period = parsePeriod(entry);
    if (!period || seen.has(period.periodType)) return undefined;
    seen.add(period.periodType);
    periods.push(period);
  }
  if (seen.size !== QUEST_BOARD_PERIOD_TYPES.length) return undefined;
  if (!isFiniteNumber(value.totalCompletions)) return undefined;
  if (!isRecord(value.completionsByPeriod)) return undefined;
  const completionsByPeriod = {} as Record<QuestBoardPeriodType, number>;
  for (const periodType of QUEST_BOARD_PERIOD_TYPES) {
    const count = value.completionsByPeriod[periodType];
    if (!isFiniteNumber(count)) return undefined;
    completionsByPeriod[periodType] = count;
  }
  if (!Array.isArray(value.history)) return undefined;
  const history: QuestBoardHistoryEntry[] = [];
  for (const entry of value.history) {
    const parsed = parseHistoryEntry(entry);
    if (!parsed) return undefined;
    history.push(parsed);
  }
  return { periods, totalCompletions: value.totalCompletions, completionsByPeriod, history };
}

function parseSuccessBody(value: unknown, requestId: string, userId: string): IvrmQuestBoardResult {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.requestId !== requestId ||
    value.discordUserId !== userId ||
    value.action !== 'status' ||
    value.status !== 'ok'
  )
    return { status: 'unavailable' };
  const board = parseQuestBoardStatus(value.board);
  if (!board) return { status: 'unavailable' };
  return { status: 'ok', board };
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<{ parsed: boolean; value: unknown }> {
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body)
    return { parsed: false, value: undefined };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { parsed: false, value: undefined };
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return { parsed: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { parsed: false, value: undefined };
  }
}

function mapErrorResponse(status: number, value: unknown): IvrmQuestBoardResult {
  const error = isRecord(value) && typeof value.error === 'string' ? value.error : null;
  const bodyStatus = isRecord(value) && typeof value.status === 'string' ? value.status : null;
  // The only 404 this endpoint answers is the unlinked member; it
  // keeps the fortune / game-accounts semantics.
  if (status === 404) return { status: 'not-linked' };
  // More than one portal member claims the Discord account: the API
  // refuses to guess, and the member has to get the link fixed.
  if (status === 409) return { status: 'duplicate' };
  if (status === 503 && (error === 'quest_board_disabled' || bodyStatus === 'disabled'))
    return { status: 'disabled' };
  if (status === 403) return { status: 'ineligible-guild' };
  return { status: 'unavailable' };
}

export async function callIvrmQuestBoard(
  guildId: string,
  userId: string,
  config = resolveQuestBoardConfig(process.env),
): Promise<IvrmQuestBoardResult> {
  if (!config) return { status: 'unconfigured' };
  if (config.guildId !== guildId) return { status: 'ineligible-guild' };
  if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(userId)) return { status: 'unavailable' };
  const requestId = randomUUID();
  const request = buildQuestBoardRequest(
    config,
    guildId,
    userId,
    requestId,
    new Date().toISOString(),
  );
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      const { parsed, value } = await readBoundedJson(response, 4096);
      // An unparsed body (for example an HTML 404 from a proxy) says
      // nothing about the member's link state, so never map its status.
      if (!parsed) return { status: 'unavailable' };
      return mapErrorResponse(response.status, value);
    }
    const { parsed, value } = await readBoundedJson(response, MAX_RESPONSE_BYTES);
    if (!parsed) return { status: 'unavailable' };
    return parseSuccessBody(value, requestId, userId);
  } catch {
    return { status: 'unavailable' };
  } // Never log URLs, response bodies or other member values.
}
