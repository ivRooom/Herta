import { timingSafeEqual } from 'node:crypto';

const MIN_INTERNAL_API_SECRET_LENGTH = 32;

export function isConfiguredInternalApiSecret(secret: string | undefined): secret is string {
  return Boolean(secret && secret.length >= MIN_INTERNAL_API_SECRET_LENGTH);
}

export function isAuthorizedInternalApiRequest(
  authorization: string | undefined,
  expectedSecret: string | undefined,
): boolean {
  if (!isConfiguredInternalApiSecret(expectedSecret) || !authorization?.startsWith('Bearer ')) {
    return false;
  }

  const supplied = authorization.slice('Bearer '.length);
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expectedSecret);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}
