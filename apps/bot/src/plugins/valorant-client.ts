import type { ValorantRegion } from '@herta/plugin-catalog';

const API_BASE_URL = 'https://api.henrikdev.xyz';
const REQUEST_TIMEOUT_MS = 8_000;
const RIOT_ID_PATTERN = /^(.{1,16})#([A-Za-z0-9]{2,8})$/u;
/** v1は非推奨。コンソール配信は現状対象外のため常にpc固定。 */
const PLATFORM = 'pc';

export interface RiotIdInput {
  name: string;
  tag: string;
}

/** `Name#Tag`形式の文字列を解析する。前後の空白は無視し、nameの最大長は16文字。 */
export function parseRiotId(value: string): RiotIdInput | null {
  const trimmed = value.trim();
  const match = RIOT_ID_PATTERN.exec(trimmed);
  if (!match) return null;
  const name = match[1]!.trim();
  const tag = match[2]!.trim();
  if (!name) return null;
  return { name, tag };
}

export interface ValorantMmrSnapshot {
  name: string;
  tag: string;
  currentTierName: string;
  currentRr: number;
  currentElo: number | null;
  peakTierName: string | null;
}

export type ValorantMmrLookupResult =
  | { status: 'ok'; snapshot: ValorantMmrSnapshot }
  | { status: 'not_found' }
  | { status: 'rate_limited' }
  | { status: 'upstream_error' };

interface HenrikDevMmrV3Response {
  data?: {
    current?: {
      tier?: { id?: number; name?: string };
      rr?: number;
      elo?: number;
    };
    peak?: {
      tier?: { id?: number; name?: string };
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * HenrikDev API (https://docs.henrikdev.xyz/valorant/api-reference/mmr) のv3 MMR
 * エンドポイントを呼び出す薄いクライアント。API Key未設定時は呼び出し元がガードする
 * 想定で、ここではURL構築とレスポンス解析だけを担う。
 */
export async function fetchValorantMmr(
  apiKey: string,
  region: ValorantRegion,
  riotId: RiotIdInput,
  fetcher: typeof fetch = fetch,
): Promise<ValorantMmrLookupResult> {
  const url = `${API_BASE_URL}/valorant/v3/mmr/${region}/${PLATFORM}/${encodeURIComponent(riotId.name)}/${encodeURIComponent(riotId.tag)}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Authorization: apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 'upstream_error' };
  }

  if (response.status === 404) return { status: 'not_found' };
  if (response.status === 429) return { status: 'rate_limited' };
  if (!response.ok) return { status: 'upstream_error' };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'upstream_error' };
  }
  if (!isRecord(payload)) return { status: 'upstream_error' };

  const current = (payload as HenrikDevMmrV3Response).data?.current;
  const peak = (payload as HenrikDevMmrV3Response).data?.peak;
  const currentTierName = current?.tier?.name;
  const currentRr = current?.rr;
  if (!currentTierName || typeof currentRr !== 'number') {
    return { status: 'upstream_error' };
  }

  return {
    status: 'ok',
    snapshot: {
      name: riotId.name,
      tag: riotId.tag,
      currentTierName,
      currentRr,
      currentElo: typeof current?.elo === 'number' ? current.elo : null,
      peakTierName: peak?.tier?.name ?? null,
    },
  };
}
