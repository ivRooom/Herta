const DEFAULT_DASHBOARD_CALLBACK_URL = '/dashboard';
const MAX_CALLBACK_URL_LENGTH = 2_048;
const CALLBACK_BASE_URL = 'https://herta.invalid';

/**
 * OAuth後の戻り先をStudio配下の相対URLだけに制限する。
 * 外部URL・protocol-relative URL・不正URLはDashboardへフォールバックする。
 */
export function normalizeDashboardCallbackUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_DASHBOARD_CALLBACK_URL;

  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_CALLBACK_URL_LENGTH) {
    return DEFAULT_DASHBOARD_CALLBACK_URL;
  }

  try {
    const url = new URL(candidate, CALLBACK_BASE_URL);
    if (url.origin !== CALLBACK_BASE_URL) return DEFAULT_DASHBOARD_CALLBACK_URL;

    const isDashboardPath =
      url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/');
    if (!isDashboardPath) return DEFAULT_DASHBOARD_CALLBACK_URL;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_DASHBOARD_CALLBACK_URL;
  }
}
