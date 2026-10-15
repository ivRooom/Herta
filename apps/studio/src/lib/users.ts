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
 *
 * 戻り値は呼び出し前にこのユーザーが存在しなかったかどうか(初回ログイン判定用)。
 * NextAuthのevents.signInが渡す`isNewUser`はadapterを使わない構成では常にfalseに
 * なるため、upsert自体の実行結果から独自に判定する。
 */
export async function upsertUserFromDiscord(input: DiscordUserInput): Promise<{
  wasNewUser: boolean;
}> {
  const data = {
    username: input.username,
    discriminator: input.discriminator ?? null,
    avatar: input.avatar ?? null,
    email: input.email ?? null,
    locale: input.locale ?? null,
  };

  const existing = await prisma.user.findUnique({ where: { id: input.id }, select: { id: true } });
  await prisma.user.upsert({
    where: { id: input.id },
    create: { id: input.id, ...data },
    update: data,
  });
  return { wasNewUser: !existing };
}
