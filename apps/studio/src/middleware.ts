import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Edge 安全な設定のみを使用する (Prisma を含まない)。
// authorized コールバックにより /dashboard 配下は未ログイン時 /login へリダイレクトされる。
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/dashboard/:path*'],
};
