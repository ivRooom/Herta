import { prisma } from '@/lib/db';

/** Discord から取得したユーザー情報 */
export interface DiscordUserInput {
  id: string;
  username: string;
  discriminator?: string | null;
  avatar?: string | null;
  email?: string | null;
  locale?: string | null;
}

/**
 * Discord ユーザーを users テーブルへ upsert する。
 * ログイン時に呼び出され、最新のプロフィール情報を保存する。
 */
export async function upsertUserFromDiscord(input: DiscordUserInput): Promise<void> {
  const data = {
    username: input.username,
    discriminator: input.discriminator ?? null,
    avatar: input.avatar ?? null,
    email: input.email ?? null,
    locale: input.locale ?? null,
  };

  await prisma.user.upsert({
    where: { id: input.id },
    create: { id: input.id, ...data },
    update: data,
  });
}
