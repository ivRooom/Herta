export function isSameOriginMutationRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin.length > 512) return false;

  const browserOrigin = parseHttpOrigin(origin);
  if (!browserOrigin) return false;

  const directOrigin = parseHttpOrigin(request.url);
  if (directOrigin && browserOrigin === directOrigin) return true;

  const configuredPublicOrigin = parseHttpOrigin(process.env['NEXTAUTH_URL']?.trim() ?? '');
  return configuredPublicOrigin !== null && browserOrigin === configuredPublicOrigin;
}

function parseHttpOrigin(value: string): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
