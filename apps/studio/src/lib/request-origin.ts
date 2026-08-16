export function isSameOriginMutationRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin.length > 512) return false;

  try {
    const browserOrigin = new URL(origin).origin;
    const directOrigin = new URL(request.url).origin;
    if (browserOrigin === directOrigin) return true;

    const forwardedOrigin = resolveForwardedRequestOrigin(request);
    return forwardedOrigin !== null && browserOrigin === forwardedOrigin;
  } catch {
    return false;
  }
}

function resolveForwardedRequestOrigin(request: Request): string | null {
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const host = request.headers.get('host')?.trim() ?? null;

  if ((forwardedProto !== 'http' && forwardedProto !== 'https') || !host || host.length > 255) {
    return null;
  }

  try {
    return new URL(`${forwardedProto}://${host}`).origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',', 1)[0]?.trim();
  return first || null;
}
