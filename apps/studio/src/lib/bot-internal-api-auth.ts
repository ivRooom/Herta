const MIN_INTERNAL_API_SECRET_LENGTH = 32;

export function getBotInternalApiAuthorizationHeader(): string | null {
  const secret = process.env['BOT_INTERNAL_API_SECRET']?.trim();
  if (!secret || secret.length < MIN_INTERNAL_API_SECRET_LENGTH) return null;
  return `Bearer ${secret}`;
}
