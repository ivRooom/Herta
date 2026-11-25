import {
  BIRTHDAY_CARD_BACKGROUND_MAX_BYTES,
  BIRTHDAY_CARD_BACKGROUND_MAX_PIXELS,
  inspectBirthdayCardBackgroundImage,
} from '@herta/shared';
import sharp from 'sharp';

const BACKGROUND_FETCH_TIMEOUT_MS = 5_000;

/**
 * Downloads the Admin-uploaded card background the ivrm-web API
 * pointed at (settings.card.backgroundUrl, #986 S5c). Only https
 * URLs are accepted (including after any redirect), the body is
 * read under the shared background byte cap, and the bytes must
 * pass both the header inspection and a real sharp decode before
 * they are trusted as a card background. Every failure resolves
 * to null so the caller falls back to the Studio-stored
 * background / preset chain instead of failing the delivery.
 * The URL is never logged: fetch errors can embed it, so callers
 * log only the fallback itself.
 */
export async function fetchBirthdayCardBackgroundImage(urlValue: string): Promise<Buffer | null> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(BACKGROUND_FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  if (!response.ok || !response.body) return null;
  if (response.url) {
    try {
      if (new URL(response.url).protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > BIRTHDAY_CARD_BACKGROUND_MAX_BYTES) return null;

  const bytes = await readBoundedBody(response.body);
  if (!bytes) return null;
  if (!inspectBirthdayCardBackgroundImage(bytes)) return null;
  try {
    // Header inspection alone cannot prove the payload decodes;
    // force a full decode through sharp at a trivial output size
    // before trusting the bytes as a background.
    await sharp(bytes, { limitInputPixels: BIRTHDAY_CARD_BACKGROUND_MAX_PIXELS })
      .resize(1, 1)
      .toBuffer();
  } catch {
    return null;
  }
  return bytes;
}

async function readBoundedBody(body: ReadableStream<Uint8Array>): Promise<Buffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BIRTHDAY_CARD_BACKGROUND_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}
