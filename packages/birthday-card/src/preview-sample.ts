import sharp from 'sharp';

/**
 * Fixed sample subject for card previews (#991 S3d-D2). The
 * name and date are constants so a preview never renders a real
 * member: the Admin text preview already uses 11月22日 as its
 * sample date, and the bot's own card tests use "Herta Member".
 */
export const BIRTHDAY_CARD_PREVIEW_SAMPLE = {
  displayName: 'Herta Member',
  month: 11,
  day: 22,
} as const;

const SAMPLE_AVATAR_SVG = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8f7bd8"/><stop offset="1" stop-color="#5d3d86"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><text x="256" y="272" text-anchor="middle" dominant-baseline="middle" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="240" font-weight="700" fill="#f7f2ff">H</text></svg>`;

let sampleAvatarPromise: Promise<Buffer> | null = null;

/**
 * The sample avatar as PNG bytes, generated in-process with
 * sharp so no binary asset has to ship with the package and the
 * renderer's Discord-CDN-only avatar rule stays untouched: the
 * preview endpoint injects these bytes through the renderer's
 * `avatarBytes` input instead of a URL. Generated once per
 * process and cached.
 */
export function createBirthdayCardSampleAvatar(): Promise<Buffer> {
  sampleAvatarPromise ??= sharp(Buffer.from(SAMPLE_AVATAR_SVG)).png().toBuffer();
  return sampleAvatarPromise;
}
