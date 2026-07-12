import type { NextAuthConfig } from 'next-auth';
import Discord from 'next-auth/providers/discord';

/** Discord OAuth で要求するスコープ */
const DISCORD_SCOPES = ['identify', 'email', 'guilds'].join(' ');

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
  session: { strategy: 'jwt' },
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
