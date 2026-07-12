import { cookies } from 'next/headers';
import { getToken } from 'next-auth/jwt';
import type { JWT } from 'next-auth/jwt';

/** HTTPS 環境かどうか (Secure Cookie 判定に使用) */
function isSecureContext(): boolean {
  const url = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? '';
  return url.startsWith('https://');
}

/** 現在のリクエストの Auth.js セッション Cookie 名 */
function sessionCookieName(): string {
  return isSecureContext() ? '__Secure-authjs.session-token' : 'authjs.session-token';
}

/**
 * サーバー専用: JWT (アクセストークンを含む) を取得する。
 * accessToken はクライアントへ露出させないため、session callback ではなく
 * この経由でのみ取り出す。
 */
async function getAuthToken(): Promise<JWT | null> {
  const cookieStore = await cookies();
  const cookieName = sessionCookieName();
  const secure = isSecureContext();

  return getToken({
    req: { headers: { cookie: cookieStore.toString() } },
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '',
    salt: cookieName,
    cookieName,
    secureCookie: secure,
  });
}

/** サーバー専用: ログインユーザーの Discord アクセストークンを取得する */
export async function getDiscordAccessToken(): Promise<string | null> {
  const token = await getAuthToken();
  if (!token || token.error === 'RefreshAccessTokenError') return null;
  return token.accessToken ?? null;
}
