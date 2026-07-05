/** JWT ペイロード */
export interface JwtPayload {
  sub: string;
  username: string;
  type: 'access' | 'refresh' | 'internal';
  iat?: number;
  exp?: number;
}

/** トークンペア */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** 認証プロバイダー */
export interface AuthProvider {
  readonly providerId: string;
  authorize(params: Record<string, unknown>): Promise<{ redirectUrl: string }>;
  callback(params: Record<string, unknown>): Promise<UserProfile>;
  refresh(refreshToken: string): Promise<TokenPair>;
}

/** ユーザープロフィール (認証後) */
export interface UserProfile {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string;
  email?: string;
  locale?: string;
}
