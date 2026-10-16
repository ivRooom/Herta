import { createHmac, randomUUID } from 'node:crypto';
import {
  EMPTY_FORTUNE_PROFILE,
  validateFortuneProfile,
  SIGNS,
  ETO,
  type FortuneProfile,
} from './fortune-core.js';

export const FORTUNE_PROFILE_PATH = '/v2/herta/fortune-profile';
export const FORTUNE_PROFILE_PURPOSE = 'herta-fortune-profile-v2';
export interface FortuneProfileConfig {
  apiBaseUrl: string;
  secret: string;
  guildId: string;
}
export type IvrmFortuneProfile =
  | { status: 'linked'; profile: FortuneProfile }
  | { status: 'not-linked' | 'ineligible-guild' | 'unavailable' | 'unconfigured' };

export function resolveFortuneProfileConfig(
  env: Partial<Record<string, string | undefined>>,
): FortuneProfileConfig | null {
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

export function buildFortuneProfileRequest(
  config: FortuneProfileConfig,
  guildId: string,
  userId: string,
  requestId: string,
  timestamp: string,
) {
  const body = JSON.stringify({ schemaVersion: 2, requestId, guildId, discordUserId: userId });
  const key = createHmac('sha256', config.secret).update(FORTUNE_PROFILE_PURPOSE).digest();
  const signature = createHmac('sha256', key)
    .update(['POST', FORTUNE_PROFILE_PATH, timestamp, requestId, body].join('\n'))
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${FORTUNE_PROFILE_PATH}`,
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
export async function fetchIvrmFortuneProfile(
  guildId: string,
  userId: string,
  date: string,
  config = resolveFortuneProfileConfig(process.env),
): Promise<IvrmFortuneProfile> {
  if (!config) return { status: 'unconfigured' };
  if (config.guildId !== guildId) return { status: 'ineligible-guild' };
  if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(userId)) return { status: 'unavailable' };
  const requestId = randomUUID();
  const request = buildFortuneProfileRequest(
    config,
    guildId,
    userId,
    requestId,
    new Date().toISOString(),
  );
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        status:
          response.status === 404
            ? 'not-linked'
            : response.status === 403
              ? 'ineligible-guild'
              : 'unavailable',
      };
    }
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
      await response.body?.cancel();
      return { status: 'unavailable' };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return { status: 'unavailable' };
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (
      !isRecord(value) ||
      value.schemaVersion !== 2 ||
      value.requestId !== requestId ||
      value.discordUserId !== userId ||
      !isRecord(value.profile)
    )
      return { status: 'unavailable' };
    const p = value.profile;
    if (
      (p.zodiacOverride != null && !(SIGNS as readonly unknown[]).includes(p.zodiacOverride)) ||
      (p.etoOverride != null && !(ETO as readonly unknown[]).includes(p.etoOverride))
    )
      return { status: 'unavailable' };
    if (
      !(
        p.birthday === null ||
        (typeof p.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.birthday))
      ) ||
      !(
        p.mbtiType === null ||
        (typeof p.mbtiType === 'string' && /^[EI][SN][TF][JP]$/.test(p.mbtiType))
      ) ||
      !(
        p.bloodType === null ||
        (typeof p.bloodType === 'string' && ['A', 'B', 'O', 'AB'].includes(p.bloodType))
      )
    )
      return { status: 'unavailable' };
    const profile: FortuneProfile = {
      ...EMPTY_FORTUNE_PROFILE,
      birthday: p.birthday as string | null,
      mbti: p.mbtiType as string | null,
      bloodType: p.bloodType as string | null,
      zodiac: (p.zodiacOverride as string | null | undefined) ?? null,
      eto: (p.etoOverride as string | null | undefined) ?? null,
    };
    validateFortuneProfile(profile, date);
    return { status: 'linked', profile };
  } catch {
    return { status: 'unavailable' };
  } // Never log URLs, response bodies, names or birthday values.
}
