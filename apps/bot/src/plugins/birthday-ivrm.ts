import { createHmac, randomUUID } from 'node:crypto';
import { resolveQuestBoardConfig, type QuestBoardConfig } from './quest-board-ivrm.js';

export const BIRTHDAY_PATH = '/v2/herta/birthday';
export const BIRTHDAY_PURPOSE = 'herta-birthday-v2';

/**
 * The today action returns one day's recipients (a single guild's
 * birthdays: at most a few dozen members) plus the active settings.
 * The cap follows the quest-board status client's 64 KiB: a larger
 * body is treated as an upstream malfunction, not parsed.
 */
const MAX_RESPONSE_BYTES = 65_536;

const REQUEST_TIMEOUT_MS = 5_000;

export type IvrmBirthdayLeapDayPolicy = 'february-28' | 'march-1' | 'skip';

export const IVRM_BIRTHDAY_LEAP_DAY_POLICIES: readonly IvrmBirthdayLeapDayPolicy[] = [
  'february-28',
  'march-1',
  'skip',
];

export const IVRM_BIRTHDAY_CARD_PRESETS = [
  'herta-night-board',
  'herta-lavender-tea',
  'herta-lavender-gifts',
] as const;

export type IvrmBirthdayCardPreset = (typeof IVRM_BIRTHDAY_CARD_PRESETS)[number];

/**
 * The card block of the active birthday settings, in the exact
 * shape the API serves (ivrm-web birthday-core payload). Layout
 * details (element positions, background asset library) are not
 * part of it: those stay Studio-owned. `backgroundUrl` is an
 * Admin-uploaded image URL; the plugin fetches it once per cycle
 * and uses it as the card background ahead of the Studio-stored
 * backgrounds (see birthday-role.ts, #986 S5c).
 */
export interface IvrmBirthdayCardSettings {
  enabled: boolean;
  preset: IvrmBirthdayCardPreset;
  backgroundUrl: string | null;
  showName: boolean;
  showAvatar: boolean;
  showBirthday: boolean;
}

/**
 * The delivery settings ivrm-web is the source of truth for once
 * the integration is switched on (#1572 S5a). pointsAmount rides
 * along in the payload but is consumed by the ivrm-web points
 * timer, never by the bot; it is validated so a malformed payload
 * fails closed instead of being half-applied.
 */
export interface IvrmBirthdaySettings {
  enabled: boolean;
  announcementChannelId: string;
  birthdayRoleId: string;
  announcementMessage: string;
  leapDayPolicy: IvrmBirthdayLeapDayPolicy;
  pointsAmount: number;
  card: IvrmBirthdayCardSettings;
}

/**
 * One member whose birthday falls on the requested JST date. The
 * API resolves the date (including the leap-day policy) on its
 * side, so recipients need no further date filtering here. Only
 * month/day ever cross the wire: no birth year, no age.
 */
export interface IvrmBirthdayRecipient {
  memberId: string;
  discordUserId: string;
  displayName: string;
  month: number;
  day: number;
}

/**
 * The result the worker branches on:
 * - 'ok' with enabled=true: deliver to recipients with settings.
 * - 'ok' with enabled=false: the Web side says delivery is off
 *   (delivery flag off, settings disabled, or nothing activated).
 *   The plugin respects it and delivers nothing this cycle.
 * - 'unavailable': transport or payload failure. The plugin falls
 *   back to the legacy registrations path so an ivrm-web outage
 *   never silently stops birthday delivery (fail-soft), and logs
 *   the fallback.
 * - 'unconfigured' / 'ineligible-guild': the integration env is
 *   not usable; treated like 'unavailable' by the caller.
 */
export type IvrmBirthdayResult =
  | {
      status: 'ok';
      enabled: true;
      settings: IvrmBirthdaySettings;
      recipients: IvrmBirthdayRecipient[];
    }
  | { status: 'ok'; enabled: false; settings: null; recipients: [] }
  | { status: 'ineligible-guild' | 'unavailable' | 'unconfigured' };

/**
 * Builds a signed request. The wire contract mirrors the
 * quest-board integration (same provisioned secret, same
 * purpose-derived HMAC key and signed message) with a birthday
 * purpose string, so a signature minted for another integration
 * is never accepted here (and vice versa). The signed body is
 * exactly the key set the API allows: schemaVersion, requestId,
 * guildId, action, localDate.
 */
export function buildBirthdayRequest(
  config: QuestBoardConfig,
  guildId: string,
  localDate: string,
  requestId: string,
  timestamp: string,
) {
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    requestId,
    guildId,
    action: 'today',
    localDate,
  };
  const body = JSON.stringify(payload);
  const key = createHmac('sha256', config.secret).update(BIRTHDAY_PURPOSE).digest();
  const signature = createHmac('sha256', key)
    .update(['POST', BIRTHDAY_PATH, timestamp, requestId, body].join('\n'))
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${BIRTHDAY_PATH}`,
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

function isDiscordId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function isLeapDayPolicy(value: unknown): value is IvrmBirthdayLeapDayPolicy {
  return (
    typeof value === 'string' &&
    (IVRM_BIRTHDAY_LEAP_DAY_POLICIES as readonly string[]).includes(value)
  );
}

function isCardPreset(value: unknown): value is IvrmBirthdayCardPreset {
  return (
    typeof value === 'string' && (IVRM_BIRTHDAY_CARD_PRESETS as readonly string[]).includes(value)
  );
}

function parseCardSettings(value: unknown): IvrmBirthdayCardSettings | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.enabled !== 'boolean' ||
    !isCardPreset(value.preset) ||
    !(value.backgroundUrl === null || typeof value.backgroundUrl === 'string') ||
    typeof value.showName !== 'boolean' ||
    typeof value.showAvatar !== 'boolean' ||
    typeof value.showBirthday !== 'boolean'
  )
    return undefined;
  return {
    enabled: value.enabled,
    preset: value.preset,
    backgroundUrl: value.backgroundUrl,
    showName: value.showName,
    showAvatar: value.showAvatar,
    showBirthday: value.showBirthday,
  };
}

function parseSettings(value: unknown): IvrmBirthdaySettings | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.enabled !== true ||
    !isDiscordId(value.announcementChannelId) ||
    !isDiscordId(value.birthdayRoleId) ||
    typeof value.announcementMessage !== 'string' ||
    value.announcementMessage.length === 0 ||
    value.announcementMessage.length > 1000 ||
    !isLeapDayPolicy(value.leapDayPolicy) ||
    typeof value.pointsAmount !== 'number' ||
    !Number.isInteger(value.pointsAmount) ||
    value.pointsAmount < 0
  )
    return undefined;
  const card = parseCardSettings(value.card);
  if (!card) return undefined;
  return {
    enabled: true,
    announcementChannelId: value.announcementChannelId,
    birthdayRoleId: value.birthdayRoleId,
    announcementMessage: value.announcementMessage,
    leapDayPolicy: value.leapDayPolicy,
    pointsAmount: value.pointsAmount,
    card,
  };
}

function parseRecipient(value: unknown): IvrmBirthdayRecipient | undefined {
  if (!isRecord(value)) return undefined;
  // Birth year / age must never cross this wire. If a payload
  // carries them anyway it is not the contract the API serves,
  // so the whole response fails closed instead of dropping the
  // fields silently.
  if ('birthYear' in value || 'age' in value) return undefined;
  if (
    typeof value.memberId !== 'string' ||
    value.memberId.length === 0 ||
    !isDiscordId(value.discordUserId) ||
    typeof value.displayName !== 'string' ||
    typeof value.month !== 'number' ||
    !Number.isInteger(value.month) ||
    value.month < 1 ||
    value.month > 12 ||
    typeof value.day !== 'number' ||
    !Number.isInteger(value.day) ||
    value.day < 1 ||
    value.day > 31
  )
    return undefined;
  return {
    memberId: value.memberId,
    discordUserId: value.discordUserId,
    displayName: value.displayName,
    month: value.month,
    day: value.day,
  };
}

function parseSuccessBody(value: unknown, requestId: string): IvrmBirthdayResult {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.requestId !== requestId ||
    value.action !== 'today' ||
    value.status !== 'ok'
  )
    return { status: 'unavailable' };
  if (value.enabled === false) {
    if (value.settings !== null || !Array.isArray(value.recipients) || value.recipients.length > 0)
      return { status: 'unavailable' };
    return { status: 'ok', enabled: false, settings: null, recipients: [] };
  }
  if (value.enabled !== true) return { status: 'unavailable' };
  const settings = parseSettings(value.settings);
  if (!settings) return { status: 'unavailable' };
  if (!Array.isArray(value.recipients)) return { status: 'unavailable' };
  const recipients: IvrmBirthdayRecipient[] = [];
  for (const entry of value.recipients) {
    const recipient = parseRecipient(entry);
    if (!recipient) return { status: 'unavailable' };
    recipients.push(recipient);
  }
  return { status: 'ok', enabled: true, settings, recipients };
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
    return {
      parsed: true,
      value: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    };
  } catch {
    return { parsed: false, value: undefined };
  }
}

/**
 * Fetches today's birthday recipients and the active settings
 * from ivrm-web. `localDate` is the JST date the caller resolved:
 * the Web side is the source of truth for which month/day counts
 * as "today" (#1572 S1), so the bot never re-derives it from the
 * guild timezone. The integration reuses the quest-board env
 * (IVRM_WEB_API_BASE_URL / HERTA_MBTI_SYNC_SECRET /
 * IVRM_INTEGRATION_GUILD_ID), so no new credential is provisioned.
 */
export async function callIvrmBirthday(
  guildId: string,
  localDate: string,
  config = resolveQuestBoardConfig(process.env),
): Promise<IvrmBirthdayResult> {
  if (!config) return { status: 'unconfigured' };
  if (config.guildId !== guildId) return { status: 'ineligible-guild' };
  if (!isDiscordId(guildId) || !/^\d{4}-\d{2}-\d{2}$/.test(localDate))
    return { status: 'unavailable' };
  const requestId = randomUUID();
  const request = buildBirthdayRequest(
    config,
    guildId,
    localDate,
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
    // Every non-200 (401/403/503/…) means "no usable answer": the
    // caller falls back to the legacy path and retries next tick.
    if (!response.ok) return { status: 'unavailable' };
    const { parsed, value } = await readBoundedJson(response, MAX_RESPONSE_BYTES);
    if (!parsed) return { status: 'unavailable' };
    return parseSuccessBody(value, requestId);
  } catch {
    return { status: 'unavailable' };
  } // Never log URLs, response bodies or other member values.
}
