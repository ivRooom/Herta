import type { NextAuthConfig } from 'next-auth';
import Discord from 'next-auth/providers/discord';

/** Discord OAuth で要求するスコープ */
const DISCORD_SCOPES = ['identify', 'email', 'guilds'].join(' ');

/**
 * ログインからの絶対セッション有効期間（秒）。
 * Auth.js(JWT戦略)は`/api/auth/session`が呼ばれるたびに無条件でCookieの有効期限を
 * `now + session.maxAge`へ延長するため、`session.maxAge`だけでは絶対期限にならず
 * 実質無期限のスライディングセッションになってしまう。そのため実際の絶対期限の強制は
 * `auth.ts`のjwtコールバックで`loginAt`（初回ログイン時刻、以後不変）を見て行う。
 * ここの値はCookie自体の最大寿命の目安（バックストップ）としてのみ使う。
 */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * Edge (middleware) でも安全に読み込める基本設定。
 * Prisma など Node.js 専用の依存はここに含めない。
 */
export const authConfig = {
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: { params: { scope: DISCORD_SCOPES } },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  callbacks: {
    /** /dashboard 配下は認証必須。未ログインなら /login へリダイレクトされる。 */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isDashboard = nextUrl.pathname.startsWith('/dashboard');
      if (isDashboard) return isLoggedIn;
      return true;
    },
  },
} satisfies NextAuthConfig;
