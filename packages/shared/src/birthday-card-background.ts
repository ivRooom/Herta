export const BIRTHDAY_CARD_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
export const BIRTHDAY_CARD_BACKGROUND_MAX_DIMENSION = 8192;
export const BIRTHDAY_CARD_BACKGROUND_MAX_PIXELS = 16_000_000;

export type BirthdayCardBackgroundContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface BirthdayCardBackgroundImageInfo {
  contentType: BirthdayCardBackgroundContentType;
  width: number;
  height: number;
}

export function inspectBirthdayCardBackgroundImage(
  bytes: Uint8Array,
): BirthdayCardBackgroundImageInfo | null {
  if (bytes.byteLength === 0 || bytes.byteLength > BIRTHDAY_CARD_BACKGROUND_MAX_BYTES) return null;

  const info = inspectPng(bytes) ?? inspectJpeg(bytes) ?? inspectWebp(bytes);
  if (!info) return null;
  if (
    info.width < 1 ||
    info.height < 1 ||
    info.width > BIRTHDAY_CARD_BACKGROUND_MAX_DIMENSION ||
    info.height > BIRTHDAY_CARD_BACKGROUND_MAX_DIMENSION ||
    info.width * info.height > BIRTHDAY_CARD_BACKGROUND_MAX_PIXELS
  ) {
    return null;
  }
  return info;
}

function inspectPng(bytes: Uint8Array): BirthdayCardBackgroundImageInfo | null {
  if (bytes.byteLength < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  if (ascii(bytes, 12, 16) !== 'IHDR') return null;
  return {
    contentType: 'image/png',
    width: readUint32Be(bytes, 16),
    height: readUint32Be(bytes, 20),
  };
}

function inspectJpeg(bytes: Uint8Array): BirthdayCardBackgroundImageInfo | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.byteLength) return null;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.byteLength) return null;
    if (sofMarkers.has(marker)) {
      if (length < 7) return null;
      return {
        contentType: 'image/jpeg',
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      };
    }
    offset += length;
  }
  return null;
}

function inspectWebp(bytes: Uint8Array): BirthdayCardBackgroundImageInfo | null {
  if (
    bytes.byteLength < 30 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const kind = ascii(bytes, 12, 16);
  if (kind === 'VP8X') {
    return {
      contentType: 'image/webp',
      width: readUint24Le(bytes, 24) + 1,
      height: readUint24Le(bytes, 27) + 1,
    };
  }
  if (kind === 'VP8L') {
    if (bytes.byteLength < 25 || bytes[20] !== 0x2f) return null;
    const b1 = bytes[21]!;
    const b2 = bytes[22]!;
    const b3 = bytes[23]!;
    const b4 = bytes[24]!;
    return {
      contentType: 'image/webp',
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  if (kind === 'VP8 ') {
    if (
      bytes.byteLength < 30 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) {
      return null;
    }
    return {
      contentType: 'image/webp',
      width: ((bytes[27]! << 8) | bytes[26]!) & 0x3fff,
      height: ((bytes[29]! << 8) | bytes[28]!) & 0x3fff,
    };
  }
  return null;
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
