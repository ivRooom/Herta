import {
  BIRTHDAY_CARD_PRESETS,
  normalizeBirthdayCardConfig,
  type BirthdayCardConfig,
  type BirthdayCardPresetId,
} from '@herta/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readRequestBodyBytes } from './bounded-request-body.ts';

export const BIRTHDAY_CARD_PREVIEW_PATH = '/api/ivrm/birthday-card/preview';
export const BIRTHDAY_CARD_PREVIEW_PURPOSE = 'herta-birthday-card-preview-v1';

export interface BirthdayCardPreviewCardInput {
  preset: BirthdayCardPresetId;
  backgroundUrl: string | null;
  showName: boolean;
  showAvatar: boolean;
  showBirthday: boolean;
}

export interface BirthdayCardPreviewInput {
  guildId: string;
  card: BirthdayCardPreviewCardInput;
}

const PRESET_IDS = BIRTHDAY_CARD_PRESETS.map((preset) => preset.id) as readonly string[];

function isValidBackgroundUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Authorizes one signed preview request, following the S5b
 * delivery-history read pattern exactly: the signing key is
 * derived from IVRM_INTEGRATION_TOKEN with a purpose string,
 * the signature covers timestamp.eventId.POST.path.rawBody,
 * freshness is five minutes, and the guild is pinned to
 * IVRM_INTEGRATION_GUILD_ID (unconfigured fails closed, 503).
 * The card payload is validated with the same constraints the
 * ivrm-web settings payload enforces (known preset, https-only
 * background URL, strict key set).
 */
export async function authorizeBirthdayCardPreview(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<BirthdayCardPreviewInput | Response> {
  const fail = (status: number, error: string) =>
    Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const secret = environment.IVRM_INTEGRATION_TOKEN,
    guild = environment.IVRM_INTEGRATION_GUILD_ID;
  if (!secret || secret.length < 32 || !guild || !/^\d{17,20}$/.test(guild))
    return fail(503, 'unconfigured');
  if (
    request.method !== 'POST' ||
    new URL(request.url).pathname !== BIRTHDAY_CARD_PREVIEW_PATH ||
    new URL(request.url).search
  )
    return fail(422, 'invalid_request');
  const timestamp = request.headers.get('X-IVRM-Timestamp') ?? '',
    event = request.headers.get('X-IVRM-Event-Id') ?? '',
    signature = request.headers.get('X-IVRM-Signature') ?? '';
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp)) ||
    Math.abs(now - Date.parse(timestamp)) > 300000 ||
    !/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(event) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return fail(401, 'invalid_service_auth');
  let bytes: Uint8Array;
  try {
    bytes = await readRequestBodyBytes(request, 8192);
  } catch {
    return fail(413, 'body_too_large');
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(422, 'invalid_request');
  }
  const key = createHmac('sha256', secret).update(BIRTHDAY_CARD_PREVIEW_PURPOSE).digest();
  const expected = createHmac('sha256', key)
    .update(`${timestamp}.${event}.POST.${BIRTHDAY_CARD_PREVIEW_PATH}.${body}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    return fail(401, 'invalid_service_auth');
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(body);
  } catch {
    return fail(422, 'invalid_request');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== ['card', 'guildId'].sort().join() ||
    value.guildId !== guild
  )
    return fail(422, 'invalid_request');
  const card = value.card;
  if (
    !card ||
    typeof card !== 'object' ||
    Array.isArray(card) ||
    Object.keys(card).sort().join() !==
      ['backgroundUrl', 'preset', 'showAvatar', 'showBirthday', 'showName'].sort().join()
  )
    return fail(422, 'invalid_request');
  const candidate = card as Record<string, unknown>;
  if (
    typeof candidate.preset !== 'string' ||
    !PRESET_IDS.includes(candidate.preset) ||
    !isValidBackgroundUrl(candidate.backgroundUrl) ||
    typeof candidate.showName !== 'boolean' ||
    typeof candidate.showAvatar !== 'boolean' ||
    typeof candidate.showBirthday !== 'boolean'
  )
    return fail(422, 'invalid_request');
  return value as unknown as BirthdayCardPreviewInput;
}

/**
 * Builds the effective card config for a preview the same way
 * the bot's API path does: the guild's Studio card config is
 * the base (layout and stored background stay Studio-owned),
 * the request overrides preset and the show flags, and age
 * display is forced off. The card is rendered even when the
 * guild has card delivery disabled — previewing before
 * activation is the point — so `birthdayCardEnabled` is
 * treated as on for the render only.
 */
export function buildBirthdayCardPreviewConfig(
  rawPluginConfig: unknown,
  card: BirthdayCardPreviewCardInput,
): BirthdayCardConfig {
  return {
    ...normalizeBirthdayCardConfig(rawPluginConfig),
    birthdayCardEnabled: true,
    birthdayCardPreset: card.preset,
    birthdayCardShowName: card.showName,
    birthdayCardShowAvatar: card.showAvatar,
    birthdayCardShowBirthday: card.showBirthday,
    birthdayCardShowAge: false,
  };
}
