import NextAuth from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { authConfig, SESSION_MAX_AGE_SECONDS } from '@/auth.config';
import { prisma } from '@/lib/db';
import { DISCORD_API_BASE } from '@/lib/discord';
import { getManageableGuilds } from '@/lib/guilds';
import { upsertUserFromDiscord } from '@/lib/users';

const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

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
        // 以後のjwtコールバックでは更新しない。sessionアクションは呼ばれるたびに
        // Cookieのmax-ageを延長するため、このフィールドだけが絶対期限の基準になる。
        token.loginAt = Date.now();

        const { wasNewUser } = await upsertUserFromDiscord({
          id: p.id,
          username: p.global_name ?? p.username ?? 'unknown',
          discriminator: p.discriminator ?? null,
          avatar: p.avatar ?? null,
          email: p.email ?? null,
          locale: p.locale ?? null,
        });

        if (account.access_token) {
          await recordStudioSignInAuditLogs(p.id, account.access_token, wasNewUser);
        }

        return token;
      }

      // ログインから絶対期限を超えていたらセッションを強制的に無効化する
      // (jwtコールバックがnullを返すとCookieがクリアされる)。
      if (typeof token.loginAt === 'number' && Date.now() - token.loginAt > SESSION_MAX_AGE_MS) {
        return null;
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

/**
 * Studioへのログインを、管理しているGuildそれぞれの監査ログへ記録する。
 * ログイン自体はGuildに紐付かない操作だが、AuditLog.guildIdは必須かつ
 * 監査ログ画面もGuild単位の表示のため、「このGuildの管理者がいつログインしたか」
 * という形でそのGuildの監査ログへ残す(管理者は通常1〜数Guildのみ管理するため
 * 書き込み件数は少ない)。失敗してもログイン自体はブロックしない。
 *
 * NextAuthのevents.signInが渡す`isNewUser`はadapterを使わない構成では常にfalseになる
 * ため使えない。jwtコールバックでの`upsertUserFromDiscord`実行結果(wasNewUser、
 * upsert前にDBへ存在したかどうか)をそのまま受け取る。
 */
async function recordStudioSignInAuditLogs(
  discordId: string,
  accessToken: string,
  wasNewUser: boolean,
): Promise<void> {
  try {
    const guilds = await getManageableGuilds(accessToken);
    if (guilds.length === 0) return;

    // AuditLog.guildIdはGuildテーブルへの外部キーのため、Studioでまだ一度も
    // 開かれていない(= Guild行がまだ無い)管理Guildについては書き込みをスキップする
    // (このフックでGuild行を新規作成する副作用は持たせない)。
    const existingGuilds = await prisma.guild.findMany({
      where: { id: { in: guilds.map((guild) => guild.id) } },
      select: { id: true },
    });
    const existingGuildIds = new Set(existingGuilds.map((guild) => guild.id));

    const results = await Promise.allSettled(
      guilds
        .filter((guild) => existingGuildIds.has(guild.id))
        .map((guild) =>
          prisma.auditLog.create({
            data: {
              guildId: guild.id,
              actorId: discordId,
              actorType: 'user',
              event: 'studio_auth.sign_in',
              severity: 'info',
              metadata: { isNewUser: wasNewUser },
            },
          }),
        ),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Studioログインの監査ログ記録に失敗しました', {
          discordId,
          errorName: result.reason instanceof Error ? result.reason.name : 'UnknownError',
        });
      }
    }
  } catch (error) {
    console.error('Studioログインの監査ログ記録に失敗しました', {
      discordId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}
