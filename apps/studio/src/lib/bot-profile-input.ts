export const BOT_NICKNAME_MAX_LENGTH = 32;
export const BOT_AVATAR_MAX_BYTES = 1024 * 1024;
export const BOT_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif'] as const;

export type BotAvatarMimeType = (typeof BOT_AVATAR_MIME_TYPES)[number];

const AVATAR_MIME_TYPE_SET = new Set<string>(BOT_AVATAR_MIME_TYPES);

export function parseBotNickname(value: unknown): string | null | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0) return null;
  if (normalized.length > BOT_NICKNAME_MAX_LENGTH) return undefined;
  return normalized;
}

export function validateBotAvatarMetadata(input: {
  type: string;
  size: number;
}): input is { type: BotAvatarMimeType; size: number } {
  return (
    AVATAR_MIME_TYPE_SET.has(input.type) &&
    Number.isSafeInteger(input.size) &&
    input.size > 0 &&
    input.size <= BOT_AVATAR_MAX_BYTES
  );
}

export function matchesBotAvatarSignature(type: BotAvatarMimeType, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  if (bytes.length < 6) return false;
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  return header === 'GIF87a' || header === 'GIF89a';
}
