export function isSameOriginMutationRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin.length > 512) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
