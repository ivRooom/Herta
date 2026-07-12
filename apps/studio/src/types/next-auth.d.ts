import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  /** セッションに Discord のユーザー情報を追加する */
  interface Session {
    user: {
      /** Discord ユーザー ID (snowflake) */
      id: string;
    } & DefaultSession['user'];
    /** トークン取得に失敗した場合のエラー種別 */
    error?: 'RefreshAccessTokenError';
  }
}

declare module 'next-auth/jwt' {
  /** JWT に Discord のアクセストークンを保持する */
  interface JWT {
    /** Discord ユーザー ID (snowflake) */
    discordId?: string;
    /** Discord OAuth アクセストークン */
    accessToken?: string;
    /** Discord OAuth リフレッシュトークン */
    refreshToken?: string;
    /** accessToken の有効期限 (epoch ミリ秒) */
    accessTokenExpires?: number;
    /** リフレッシュ失敗時のエラー */
    error?: 'RefreshAccessTokenError';
  }
}
