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

export type GameAccountsAction = 'link' | 'unlink' | 'list' | 'score' | 'card';

export interface GameAccountsRequestInput {
  action: GameAccountsAction;
  gameCode?: string;
  uid?: string;
  region?: string;
  /** Card action only: which character's build card to render. */
  characterId?: string;
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
  | { status: 'card-unavailable' }
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
