const DEFAULT_DASHBOARD_CALLBACK_URL = '/dashboard';
const MAX_CALLBACK_URL_LENGTH = 2_048;
const CALLBACK_BASE_URL = 'https://herta.invalid';
const BIRTHDAY_REGISTRATION_PATH_PATTERN = /^\/birthday\/register\/\d{17,20}$/u;

/**
 * OAuth後の戻り先をStudio内の許可済み相対URLだけに制限する。
 * 外部URL・protocol-relative URL・不正URLはDashboardへフォールバックする。
 */
export function normalizeStudioCallbackUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_DASHBOARD_CALLBACK_URL;

  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_CALLBACK_URL_LENGTH) {
    return DEFAULT_DASHBOARD_CALLBACK_URL;
  }

  try {
    const url = new URL(candidate, CALLBACK_BASE_URL);
    if (url.origin !== CALLBACK_BASE_URL) return DEFAULT_DASHBOARD_CALLBACK_URL;

    const isDashboardPath = url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/');
    const isBirthdayRegistrationPath = BIRTHDAY_REGISTRATION_PATH_PATTERN.test(url.pathname);
    if (!isDashboardPath && !isBirthdayRegistrationPath) return DEFAULT_DASHBOARD_CALLBACK_URL;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_DASHBOARD_CALLBACK_URL;
  }
}

/** @deprecated 名前は互換維持用。新規コードでは normalizeStudioCallbackUrl を使用する。 */
export const normalizeDashboardCallbackUrl = normalizeStudioCallbackUrl;
