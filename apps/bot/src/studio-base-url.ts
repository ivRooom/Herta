/**
 * Studio公開URLの基底を解決する。マジックリンク等、同意情報を含むURLを構築する際に使う。
 * 本番はhttps必須、開発時のみlocalhost httpを許容し、埋め込み認証情報(user:pass@)は拒否する。
 */
export function resolveStudioPublicBaseUrl(
  env: Record<string, string | undefined> = process.env,
): URL | null {
  const raw = env['STUDIO_PUBLIC_BASE_URL']?.trim();
  try {
    const base = new URL(raw ?? '');
    const localHttp =
      env['NODE_ENV'] !== 'production' &&
      base.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !localHttp) || base.username || base.password) {
      return null;
    }
    return base;
  } catch {
    return null;
  }
}
