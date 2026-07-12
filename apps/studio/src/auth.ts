import NextAuth from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { authConfig } from '@/auth.config';
import { DISCORD_API_BASE } from '@/lib/discord';
import { upsertUserFromDiscord } from '@/lib/users';

/** Discord OAuth の profile レスポンス (利用するフィールドのみ) */
interface DiscordProfile {
  id: string;
  username?: string;
  global_name?: string | null;
  discriminator?: string | null;
  avatar?: string | null;
  email?: string | null;
  locale?: string | null;
}

/** リフレッシュトークンを用いて Discord アクセストークンを更新する */
async function refreshDiscordToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) throw new Error('refresh token がありません');

    const res = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID ?? '',
        client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    });

    const refreshed = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!res.ok || !refreshed.access_token) {
      throw new Error('Discord トークンの更新に失敗しました');
    }

    return {
      ...token,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      accessTokenExpires: Date.now() + (refreshed.expires_in ?? 604800) * 1000,
      error: undefined,
    };
  } catch {
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, account, profile }) {
      // 初回ログイン時: アカウント情報をトークンに保存し、ユーザーを DB へ upsert
      if (account && profile) {
        const p = profile as unknown as DiscordProfile;
        token.discordId = p.id;
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 604800 * 1000;

        await upsertUserFromDiscord({
          id: p.id,
          username: p.global_name ?? p.username ?? 'unknown',
          discriminator: p.discriminator ?? null,
          avatar: p.avatar ?? null,
          email: p.email ?? null,
          locale: p.locale ?? null,
        });

        return token;
      }

      // 有効期限内はそのまま返す
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
        return token;
      }

      // 期限切れなら更新を試みる
      return refreshDiscordToken(token);
    },
    async session({ session, token }) {
      if (token.discordId) {
        session.user.id = token.discordId;
      }
      session.error = token.error;
      return session;
    },
  },
});
