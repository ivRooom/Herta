import { createHmac, randomUUID } from 'node:crypto';
import type { AchievementPayload } from './achievement-notifications.js';

export const ACHIEVEMENT_CARD_PATH = '/v2/herta/achievement-card';
export const ACHIEVEMENT_CARD_PURPOSE = 'herta-achievement-card-v2';

/**
 * アチーブメント解除通知の画像カード取得クライアント (Herta #965)。
 *
 * ivrm-web の署名付きカード API から解除 1 件分の PNG を取得する。
 * 署名方式・env 名・応答検証の作法は Bot の quest-board クライアント
 * (apps/bot/src/plugins/quest-board-ivrm.ts) と同一に揃える。通知は
 * fail-soft が原則で、このクライアントは例外を投げず、カードを
 * 使えないあらゆる場合に null を返す (呼び出し側はテキスト Embed
 * のみで送信する)。
 */

/** 描画済み PNG の上限。カード 1 枚として十分な大きさで打ち切る。 */
const MAX_CARD_PNG_BYTES = 10 * 1024 * 1024;

/**
 * 成功応答 (JSON envelope + base64) の読み取り上限。10 MiB の PNG が
 * base64 で約 13.3 MiB になるため、それに envelope 分を加えて収める。
 */
const MAX_CARD_RESPONSE_BYTES = 16 * 1024 * 1024;

/** サーバー側描画を見込むため、quest-board のカードと同じ 20 秒。 */
const CARD_REQUEST_TIMEOUT_MS = 20_000;

export interface AchievementCardConfig {
  apiBaseUrl: string;
  secret: string;
}

export interface AchievementCardRequestInput {
  guildId: string;
  discordUserId: string;
  displayName: string;
  payload: AchievementPayload;
}

/**
 * quest-board クライアントと同じ env 名を使う
 * (IVRM_WEB_API_BASE_URL / HERTA_MBTI_SYNC_SECRET)。未設定・不正な
 * 場合は null を返し、カード取得自体をスキップさせる。
 */
export function resolveAchievementCardConfig(
  env: Partial<Record<string, string | undefined>>,
): AchievementCardConfig | null {
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
    return { apiBaseUrl: url.origin, secret };
  } catch {
    return null;
  }
}

/**
 * 署名付きリクエストを組み立てる。署名の作法は quest-board と同一:
 * purpose 文字列から導出した鍵で、POST・パス・タイムスタンプ・
 * requestId・本文を改行で連結したものへ HMAC-SHA256 を付ける。
 */
export function buildAchievementCardRequest(
  config: AchievementCardConfig,
  input: AchievementCardRequestInput,
  requestId: string,
  timestamp: string,
) {
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    requestId,
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    displayName: input.displayName,
    payload: {
      code: input.payload.code,
      name: input.payload.name,
      tier: input.payload.tier,
      xpReward: input.payload.xpReward,
      unlockedAt: input.payload.unlockedAt,
    },
  };
  const body = JSON.stringify(payload);
  const key = createHmac('sha256', config.secret).update(ACHIEVEMENT_CARD_PURPOSE).digest();
  const signature = createHmac('sha256', key)
    .update(['POST', ACHIEVEMENT_CARD_PATH, timestamp, requestId, body].join('\n'))
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${ACHIEVEMENT_CARD_PATH}`,
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

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
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
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function asValidPng(bytes: Uint8Array): Buffer | null {
  if (bytes.length <= PNG_MAGIC.length || bytes.length > MAX_CARD_PNG_BYTES) return null;
  if (!PNG_MAGIC.every((byte, index) => bytes[index] === byte)) return null;
  return Buffer.from(bytes);
}

/**
 * 成功応答を検証する。JSON envelope の場合は echo (requestId /
 * discordUserId) と status を照合し、card.pngBase64 を復号してから
 * PNG として検証する。検証できない応答は上流の異常として null。
 */
function parseCardSuccessBody(
  bytes: Uint8Array,
  requestId: string,
  discordUserId: string,
): Buffer | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.requestId !== requestId ||
    value.discordUserId !== discordUserId ||
    value.status !== 'ok' ||
    !isRecord(value.card) ||
    typeof value.card.pngBase64 !== 'string'
  )
    return null;
  return asValidPng(Buffer.from(value.card.pngBase64, 'base64'));
}

/**
 * カード PNG を 1 件取得する。未設定・検証失敗・HTTP エラー・
 * ネットワーク失敗のいずれでも例外を投げず null を返す。
 */
export async function fetchAchievementCardPng(
  input: AchievementCardRequestInput,
  config: AchievementCardConfig | null = resolveAchievementCardConfig(process.env),
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer | null> {
  if (!config) return null;
  if (!/^\d{17,20}$/.test(input.guildId) || !/^\d{17,20}$/.test(input.discordUserId)) return null;
  const requestId = randomUUID();
  const request = buildAchievementCardRequest(config, input, requestId, new Date().toISOString());
  try {
    const response = await fetchImpl(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(CARD_REQUEST_TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('image/png')) {
      // 生の PNG が返る形式にも耐える (envelope 形式が本命)。
      const bytes = await readBoundedBytes(response, MAX_CARD_PNG_BYTES);
      return bytes ? asValidPng(bytes) : null;
    }
    if (!contentType.includes('application/json')) return null;
    const bytes = await readBoundedBytes(response, MAX_CARD_RESPONSE_BYTES);
    if (!bytes) return null;
    return parseCardSuccessBody(bytes, requestId, input.discordUserId);
  } catch {
    return null;
  } // Never log URLs, response bodies or other member values.
}
