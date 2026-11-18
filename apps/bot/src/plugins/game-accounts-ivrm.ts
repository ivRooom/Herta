import { createHmac, randomUUID } from 'node:crypto';

export const GAME_ACCOUNTS_PATH = '/v2/herta/game-accounts';
export const GAME_ACCOUNTS_PURPOSE = 'herta-game-accounts-v2';

/**
 * Score responses carry every showcased character, so the body cap is much
 * larger than the fortune profile's 4 KiB. It stays bounded: a snapshot with
 * more data than this is treated as an upstream malfunction, not parsed.
 */
const MAX_RESPONSE_BYTES = 65_536;

/**
 * Card responses carry one base64 PNG (1600x900, roughly 1.5 MiB raw), so
 * the cap is sized for a single card plus JSON overhead. The client only
 * ever requests one character's card at a time; anything larger than this
 * is treated as an upstream malfunction, not parsed.
 */
const MAX_CARD_RESPONSE_BYTES = 4 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 5_000;
/** Rendering a card runs sharp plus CDN asset fetches on the API side. */
const CARD_REQUEST_TIMEOUT_MS = 20_000;

export interface GameAccountsConfig {
  apiBaseUrl: string;
  secret: string;
  guildId: string;
}

export type GameAccountsAction =
  'link' | 'unlink' | 'list' | 'score' | 'card' | 'progress' | 'ranking';

export interface GameAccountsRequestInput {
  action: GameAccountsAction;
  gameCode?: string;
  uid?: string;
  region?: string;
  /** Card action only: which character's build card to render. */
  characterId?: string;
  /** Ranking action only (#1196 R3): axis / slot / formula / page size. */
  axis?: string;
  slot?: string;
  formula?: string;
  limit?: number;
}

export interface GameCardPng {
  characterId: string;
  /** Japanese character name when the Web snapshot resolved one. */
  name: string | null;
  score: number | null;
  png: Buffer;
}

export interface LinkedGameAccount {
  gameCode: string;
  uid: string;
  region: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GameAccountListEntry extends LinkedGameAccount {
  showcaseStatus: string | null;
  showcaseFetchedAt: string | null;
}

export interface ArtifactScorePiece {
  cv: number;
  /** Effective-roll counts keyed by stat (e.g. critRate, critDmg). */
  rolls: Record<string, number>;
}

export interface ArtifactScore {
  total: number;
  perPiece: ArtifactScorePiece[];
  version: number;
}

export interface ShowcaseCharacterScore {
  id: string;
  /** Japanese character name when the Web snapshot resolved one. */
  name: string | null;
  level: number;
  artifactScore: ArtifactScore | null;
}

export interface LinkShowcaseState {
  status: string;
  stale: boolean;
  fetchedAt: string | null;
}

/** One explored area of a HoYoLAB progress snapshot (Genshin only). */
export interface HoyolabExploration {
  id: number | null;
  /** Localized area name as returned by HoYoLAB. */
  name: string | null;
  /** Exploration percent, 0-100 with one decimal. */
  percent: number | null;
  /** Reputation / area level where the area carries one. */
  level: number | null;
  offerings: { name: string | null; level: number | null }[];
}

export type HoyolabEndgameKind =
  'spiral_abyss' | 'memory_of_chaos' | 'pure_fiction' | 'apocalyptic_shadow';

export interface HoyolabEndgameEntry {
  kind: HoyolabEndgameKind;
  scheduleId: number | null;
  /** Deepest floor/stage label verbatim ("12-3" for the Abyss). */
  maxFloor: string | null;
  totalStars: number | null;
  totalScore: number | null;
  /** Whether the account has any recorded attempt this schedule. */
  hasData: boolean;
}

/**
 * The display-relevant slice of the API's HoyolabProgressSnapshot
 * (ivrm-web integrations/hoyolab.ts). The stored snapshot also carries
 * provider/server/roster data the bot never renders; the parser keeps
 * only what the progress embed reads and drops the rest.
 */
export interface HoyolabProgressSnapshot {
  gameCode: string;
  uid: string;
  player: { nickname: string | null; level: number | null };
  stats: Record<string, number | string | null>;
  explorations: HoyolabExploration[];
  endgame: HoyolabEndgameEntry[];
}

export type GameRankingAxis = 'character' | 'piece' | 'formula';
export type GameRankingFormula = 'cv' | 'rolls';

export interface GameRankingEntry {
  rank: number;
  /** Approved display name; the API never sends a UID or member id. */
  memberName: string;
  isSelf: boolean;
  characterId: string;
  characterNameJa: string | null;
  score: number;
  slot: string | null;
  rollsTotal: number;
  fetchedAt: string | null;
}

export interface GameRankingAvailableCharacter {
  characterId: string;
  characterNameJa: string | null;
  memberCount: number;
}

export type IvrmGameAccountsResult =
  | { status: 'ok'; action: 'link'; account: LinkedGameAccount; showcase: LinkShowcaseState }
  | { status: 'ok'; action: 'unlink'; gameCode: string }
  | { status: 'ok'; action: 'list'; accounts: GameAccountListEntry[] }
  | {
      status: 'ok';
      action: 'score';
      gameCode: string;
      uid: string;
      showcaseStatus: string | null;
      fetchedAt: string | null;
      hasSnapshot: boolean;
      characters: ShowcaseCharacterScore[];
    }
  | {
      status: 'ok';
      action: 'card';
      gameCode: string;
      uid: string;
      fetchedAt: string | null;
      cards: GameCardPng[];
    }
  | {
      status: 'ok';
      action: 'progress';
      gameCode: string;
      uid: string;
      /** Stored progress status ("ok", "not_public", ...); null until the first refresh attempt. */
      progressStatus: string | null;
      fetchedAt: string | null;
      succeededAt: string | null;
      hasProgress: boolean;
      progress: HoyolabProgressSnapshot | null;
    }
  | {
      status: 'ok';
      action: 'ranking';
      gameCode: string;
      axis: GameRankingAxis;
      formula: GameRankingFormula;
      characterId: string | null;
      slot: string | null;
      limit: number;
      populationSize: number;
      viewerInPopulation: boolean;
      entries: GameRankingEntry[];
      selfEntries: GameRankingEntry[];
      availableCharacters: GameRankingAvailableCharacter[];
      availableSlots: string[];
    }
  | { status: 'card-unavailable' }
  | { status: 'progress-unsupported' }
  | { status: 'not-linked' }
  | { status: 'not-found'; error: 'game_not_found' | 'game_account_not_found' }
  | { status: 'invalid-input'; field: string | null; message: string }
  | { status: 'ineligible-guild' | 'unavailable' | 'unconfigured' };

export function resolveGameAccountsConfig(
  env: Partial<Record<string, string | undefined>>,
): GameAccountsConfig | null {
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

export function buildGameAccountsRequest(
  config: GameAccountsConfig,
  guildId: string,
  userId: string,
  input: GameAccountsRequestInput,
  requestId: string,
  timestamp: string,
) {
  const payload: Record<string, unknown> = {
    schemaVersion: 2,
    requestId,
    guildId,
    discordUserId: userId,
    action: input.action,
  };
  if (input.gameCode !== undefined) payload.gameCode = input.gameCode;
  if (input.uid !== undefined) payload.uid = input.uid;
  if (input.region !== undefined) payload.region = input.region;
  if (input.characterId !== undefined) payload.characterId = input.characterId;
  if (input.axis !== undefined) payload.axis = input.axis;
  if (input.slot !== undefined) payload.slot = input.slot;
  if (input.formula !== undefined) payload.formula = input.formula;
  if (input.limit !== undefined) payload.limit = input.limit;
  const body = JSON.stringify(payload);
  const key = createHmac('sha256', config.secret).update(GAME_ACCOUNTS_PURPOSE).digest();
  const signature = createHmac('sha256', key)
    .update(['POST', GAME_ACCOUNTS_PATH, timestamp, requestId, body].join('\n'))
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${GAME_ACCOUNTS_PATH}`,
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

function parseLinkedAccount(value: unknown): LinkedGameAccount | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.gameCode !== 'string' ||
    typeof value.uid !== 'string' ||
    !isStringOrNull(value.region) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  )
    return null;
  return {
    gameCode: value.gameCode,
    uid: value.uid,
    region: value.region,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseArtifactScore(value: unknown): ArtifactScore | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value.total) || !isFiniteNumber(value.version)) return undefined;
  if (!Array.isArray(value.perPiece)) return undefined;
  const perPiece: ArtifactScorePiece[] = [];
  for (const piece of value.perPiece) {
    if (!isRecord(piece) || !isFiniteNumber(piece.cv) || !isRecord(piece.rolls)) return undefined;
    const rolls: Record<string, number> = {};
    for (const [stat, count] of Object.entries(piece.rolls)) {
      if (!isFiniteNumber(count)) return undefined;
      rolls[stat] = count;
    }
    perPiece.push({ cv: piece.cv, rolls });
  }
  return { total: value.total, perPiece, version: value.version };
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

const HOYOLAB_ENDGAME_KINDS: readonly string[] = [
  'spiral_abyss',
  'memory_of_chaos',
  'pure_fiction',
  'apocalyptic_shadow',
];

/**
 * Validates a stored HoYoLAB progress snapshot. Returns null for the
 * explicit no-snapshot value and undefined for anything malformed, so
 * a corrupt upstream payload fails closed like every other action.
 */
function parseHoyolabProgress(value: unknown): HoyolabProgressSnapshot | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (typeof value.gameCode !== 'string' || typeof value.uid !== 'string') return undefined;
  if (
    !isRecord(value.player) ||
    !isStringOrNull(value.player.nickname) ||
    !isNumberOrNull(value.player.level)
  )
    return undefined;
  if (!isRecord(value.stats)) return undefined;
  const stats: Record<string, number | string | null> = {};
  for (const [key, entry] of Object.entries(value.stats)) {
    if (!(entry === null || typeof entry === 'string' || isFiniteNumber(entry))) return undefined;
    stats[key] = entry;
  }
  if (!Array.isArray(value.explorations) || !Array.isArray(value.endgame)) return undefined;
  const explorations: HoyolabExploration[] = [];
  for (const entry of value.explorations) {
    if (!isRecord(entry)) return undefined;
    if (
      !isNumberOrNull(entry.id) ||
      !isStringOrNull(entry.name) ||
      !isNumberOrNull(entry.percent) ||
      !isNumberOrNull(entry.level) ||
      !Array.isArray(entry.offerings)
    )
      return undefined;
    const offerings: HoyolabExploration['offerings'] = [];
    for (const offering of entry.offerings) {
      if (!isRecord(offering) || !isStringOrNull(offering.name) || !isNumberOrNull(offering.level))
        return undefined;
      offerings.push({ name: offering.name, level: offering.level });
    }
    explorations.push({
      id: entry.id,
      name: entry.name,
      percent: entry.percent,
      level: entry.level,
      offerings,
    });
  }
  const endgame: HoyolabEndgameEntry[] = [];
  for (const entry of value.endgame) {
    if (!isRecord(entry)) return undefined;
    if (
      typeof entry.kind !== 'string' ||
      !HOYOLAB_ENDGAME_KINDS.includes(entry.kind) ||
      !isNumberOrNull(entry.scheduleId) ||
      !isStringOrNull(entry.maxFloor) ||
      !isNumberOrNull(entry.totalStars) ||
      !isNumberOrNull(entry.totalScore) ||
      typeof entry.hasData !== 'boolean'
    )
      return undefined;
    endgame.push({
      kind: entry.kind as HoyolabEndgameKind,
      scheduleId: entry.scheduleId,
      maxFloor: entry.maxFloor,
      totalStars: entry.totalStars,
      totalScore: entry.totalScore,
      hasData: entry.hasData,
    });
  }
  return {
    gameCode: value.gameCode,
    uid: value.uid,
    player: { nickname: value.player.nickname, level: value.player.level },
    stats,
    explorations,
    endgame,
  };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Decodes a card PNG from base64, rejecting anything that is not a
 * well-formed base64 string carrying an actual PNG. A malformed or
 * non-PNG payload is an upstream malfunction, never an attachment.
 */
function decodePngBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    return null;
  const png = Buffer.from(value, 'base64');
  if (png.byteLength <= PNG_MAGIC.length) return null;
  if (!PNG_MAGIC.every((byte, index) => png[index] === byte)) return null;
  return png;
}

const RANKING_AXES: readonly string[] = ['character', 'piece', 'formula'];
const RANKING_FORMULAS: readonly string[] = ['cv', 'rolls'];

function parseRankingEntry(value: unknown): GameRankingEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.rank !== 'number' ||
    !Number.isInteger(value.rank) ||
    value.rank < 1 ||
    typeof value.memberName !== 'string' ||
    typeof value.isSelf !== 'boolean' ||
    typeof value.characterId !== 'string' ||
    !isStringOrNull(value.characterNameJa) ||
    !isFiniteNumber(value.score) ||
    !isStringOrNull(value.slot) ||
    !isFiniteNumber(value.rollsTotal) ||
    !isStringOrNull(value.fetchedAt)
  )
    return undefined;
  return {
    rank: value.rank,
    memberName: value.memberName,
    isSelf: value.isSelf,
    characterId: value.characterId,
    characterNameJa: value.characterNameJa,
    score: value.score,
    slot: value.slot,
    rollsTotal: value.rollsTotal,
    fetchedAt: value.fetchedAt,
  };
}

function parseRankingEntries(value: unknown): GameRankingEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: GameRankingEntry[] = [];
  for (const entry of value) {
    const parsed = parseRankingEntry(entry);
    if (!parsed) return undefined;
    entries.push(parsed);
  }
  return entries;
}

function parseSuccessBody(
  value: unknown,
  input: GameAccountsRequestInput,
  requestId: string,
  userId: string,
): IvrmGameAccountsResult {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    value.requestId !== requestId ||
    value.discordUserId !== userId ||
    value.action !== input.action
  )
    return { status: 'unavailable' };
  switch (input.action) {
    case 'link': {
      const account = parseLinkedAccount(value.account);
      if (!account || !isRecord(value.showcase)) return { status: 'unavailable' };
      if (
        typeof value.showcase.status !== 'string' ||
        typeof value.showcase.stale !== 'boolean' ||
        !isStringOrNull(value.showcase.fetchedAt)
      )
        return { status: 'unavailable' };
      return {
        status: 'ok',
        action: 'link',
        account,
        showcase: {
          status: value.showcase.status,
          stale: value.showcase.stale,
          fetchedAt: value.showcase.fetchedAt,
        },
      };
    }
    case 'unlink': {
      if (typeof value.gameCode !== 'string' || value.deleted !== true)
        return { status: 'unavailable' };
      return { status: 'ok', action: 'unlink', gameCode: value.gameCode };
    }
    case 'list': {
      if (!Array.isArray(value.accounts)) return { status: 'unavailable' };
      const accounts: GameAccountListEntry[] = [];
      for (const entry of value.accounts) {
        const account = parseLinkedAccount(entry);
        if (!account || !isRecord(entry)) return { status: 'unavailable' };
        if (!isStringOrNull(entry.showcaseStatus) || !isStringOrNull(entry.showcaseFetchedAt))
          return { status: 'unavailable' };
        accounts.push({
          ...account,
          showcaseStatus: entry.showcaseStatus,
          showcaseFetchedAt: entry.showcaseFetchedAt,
        });
      }
      return { status: 'ok', action: 'list', accounts };
    }
    case 'score': {
      if (
        typeof value.gameCode !== 'string' ||
        typeof value.uid !== 'string' ||
        !isStringOrNull(value.showcaseStatus) ||
        !isStringOrNull(value.fetchedAt) ||
        typeof value.hasSnapshot !== 'boolean' ||
        !Array.isArray(value.characters)
      )
        return { status: 'unavailable' };
      const characters: ShowcaseCharacterScore[] = [];
      for (const character of value.characters) {
        if (!isRecord(character)) return { status: 'unavailable' };
        if (
          !(typeof character.id === 'string' || isFiniteNumber(character.id)) ||
          !isStringOrNull(character.name) ||
          !isFiniteNumber(character.level)
        )
          return { status: 'unavailable' };
        const artifactScore = parseArtifactScore(character.artifactScore);
        if (artifactScore === undefined) return { status: 'unavailable' };
        characters.push({
          id: String(character.id),
          name: character.name,
          level: character.level,
          artifactScore,
        });
      }
      return {
        status: 'ok',
        action: 'score',
        gameCode: value.gameCode,
        uid: value.uid,
        showcaseStatus: value.showcaseStatus,
        fetchedAt: value.fetchedAt,
        hasSnapshot: value.hasSnapshot,
        characters,
      };
    }
    case 'card': {
      if (
        typeof value.gameCode !== 'string' ||
        typeof value.uid !== 'string' ||
        !isStringOrNull(value.fetchedAt) ||
        !Array.isArray(value.cards)
      )
        return { status: 'unavailable' };
      const cards: GameCardPng[] = [];
      for (const card of value.cards) {
        if (!isRecord(card)) return { status: 'unavailable' };
        if (
          !(typeof card.characterId === 'string' || isFiniteNumber(card.characterId)) ||
          !isStringOrNull(card.name) ||
          !(card.score === null || isFiniteNumber(card.score)) ||
          typeof card.pngBase64 !== 'string'
        )
          return { status: 'unavailable' };
        const png = decodePngBase64(card.pngBase64);
        if (!png) return { status: 'unavailable' };
        cards.push({
          characterId: String(card.characterId),
          name: card.name,
          score: card.score,
          png,
        });
      }
      return {
        status: 'ok',
        action: 'card',
        gameCode: value.gameCode,
        uid: value.uid,
        fetchedAt: value.fetchedAt,
        cards,
      };
    }
    case 'ranking': {
      if (
        typeof value.gameCode !== 'string' ||
        typeof value.axis !== 'string' ||
        !RANKING_AXES.includes(value.axis) ||
        typeof value.formula !== 'string' ||
        !RANKING_FORMULAS.includes(value.formula) ||
        !isStringOrNull(value.characterId) ||
        !isStringOrNull(value.slot) ||
        !isFiniteNumber(value.limit) ||
        !isFiniteNumber(value.populationSize) ||
        typeof value.viewerInPopulation !== 'boolean' ||
        !Array.isArray(value.availableSlots)
      )
        return { status: 'unavailable' };
      const entries = parseRankingEntries(value.entries);
      const selfEntries = parseRankingEntries(value.selfEntries);
      if (!entries || !selfEntries) return { status: 'unavailable' };
      const availableCharacters: GameRankingAvailableCharacter[] = [];
      if (!Array.isArray(value.availableCharacters)) return { status: 'unavailable' };
      for (const character of value.availableCharacters) {
        if (!isRecord(character)) return { status: 'unavailable' };
        if (
          typeof character.characterId !== 'string' ||
          !isStringOrNull(character.characterNameJa) ||
          !isFiniteNumber(character.memberCount)
        )
          return { status: 'unavailable' };
        availableCharacters.push({
          characterId: character.characterId,
          characterNameJa: character.characterNameJa,
          memberCount: character.memberCount,
        });
      }
      const availableSlots: string[] = [];
      for (const slot of value.availableSlots) {
        if (typeof slot !== 'string') return { status: 'unavailable' };
        availableSlots.push(slot);
      }
      return {
        status: 'ok',
        action: 'ranking',
        gameCode: value.gameCode,
        axis: value.axis as GameRankingAxis,
        formula: value.formula as GameRankingFormula,
        characterId: value.characterId,
        slot: value.slot,
        limit: value.limit,
        populationSize: value.populationSize,
        viewerInPopulation: value.viewerInPopulation,
        entries,
        selfEntries,
        availableCharacters,
        availableSlots,
      };
    }
    case 'progress': {
      if (
        typeof value.gameCode !== 'string' ||
        typeof value.uid !== 'string' ||
        !isStringOrNull(value.status) ||
        !isStringOrNull(value.fetchedAt) ||
        !isStringOrNull(value.succeededAt) ||
        typeof value.hasProgress !== 'boolean'
      )
        return { status: 'unavailable' };
      const progress = parseHoyolabProgress(value.progress);
      // The API's hasProgress is exactly "a snapshot is stored"; a body
      // that disagrees with itself is an upstream malfunction.
      if (progress === undefined || value.hasProgress !== (progress !== null))
        return { status: 'unavailable' };
      return {
        status: 'ok',
        action: 'progress',
        gameCode: value.gameCode,
        uid: value.uid,
        progressStatus: value.status,
        fetchedAt: value.fetchedAt,
        succeededAt: value.succeededAt,
        hasProgress: value.hasProgress,
        progress,
      };
    }
  }
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

function mapErrorResponse(
  status: number,
  value: unknown,
  input: GameAccountsRequestInput,
): IvrmGameAccountsResult {
  const error = isRecord(value) && typeof value.error === 'string' ? value.error : null;
  // Card-specific failures (no snapshot/build for the character, an
  // unsupported game, a render failure) are not user-facing errors: the
  // caller falls back to the text score view, so they share one status.
  if (input.action === 'card') {
    if (
      (status === 404 && (error === 'card_unavailable' || error === 'character_not_found')) ||
      (status === 422 && error === 'card_not_supported')
    )
      return { status: 'card-unavailable' };
  }
  // Progress on a game without a HoYoLAB record is a display concern,
  // not an input error: the plugin answers with its unsupported embed.
  if (input.action === 'progress' && status === 422 && error === 'progress_not_supported')
    return { status: 'progress-unsupported' };
  if (status === 404) {
    if (error === 'game_not_found' || error === 'game_account_not_found')
      return { status: 'not-found', error };
    // member_not_linked and any other 404 keep the fortune client's semantics:
    // the invoking member has no linked ivrm-web account to act on.
    return { status: 'not-linked' };
  }
  if (status === 403) return { status: 'ineligible-guild' };
  if (status === 422) {
    const field = isRecord(value) && typeof value.field === 'string' ? value.field : null;
    const message =
      isRecord(value) && typeof value.message === 'string'
        ? value.message
        : '入力内容が正しくありません。';
    return { status: 'invalid-input', field, message };
  }
  return { status: 'unavailable' };
}

export async function callIvrmGameAccounts(
  guildId: string,
  userId: string,
  input: GameAccountsRequestInput,
  config = resolveGameAccountsConfig(process.env),
): Promise<IvrmGameAccountsResult> {
  if (!config) return { status: 'unconfigured' };
  if (config.guildId !== guildId) return { status: 'ineligible-guild' };
  if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(userId)) return { status: 'unavailable' };
  const requestId = randomUUID();
  const request = buildGameAccountsRequest(
    config,
    guildId,
    userId,
    input,
    requestId,
    new Date().toISOString(),
  );
  const isCard = input.action === 'card';
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(isCard ? CARD_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      const { value } = await readBoundedJson(response, 4096);
      return mapErrorResponse(response.status, value, input);
    }
    const { parsed, value } = await readBoundedJson(
      response,
      isCard ? MAX_CARD_RESPONSE_BYTES : MAX_RESPONSE_BYTES,
    );
    if (!parsed) return { status: 'unavailable' };
    return parseSuccessBody(value, input, requestId, userId);
  } catch {
    return { status: 'unavailable' };
  } // Never log URLs, response bodies, UIDs or other member values.
}
