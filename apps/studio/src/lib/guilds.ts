import { prisma } from '@/lib/db';
import { fetchManageableGuilds, type ManageableGuild } from '@/lib/discord';

/** ログインユーザーが管理可能な Guild 一覧を取得する */
export async function getManageableGuilds(accessToken: string): Promise<ManageableGuild[]> {
  return fetchManageableGuilds(accessToken);
}

/**
 * 指定した Guild をログインユーザーが管理可能か確認し、その Guild を返す。
 * 管理権限が無い場合は null を返す (権限のない Guild へのアクセスを防ぐ)。
 */
export async function getManageableGuild(
  accessToken: string,
  guildId: string,
): Promise<ManageableGuild | null> {
  const guilds = await fetchManageableGuilds(accessToken);
  return guilds.find((g) => g.id === guildId) ?? null;
}

/**
 * 選択された Guild と、ログインユーザーのメンバーシップを DB へ保存する。
 * 呼び出し元で管理権限を検証済みであることを前提とする。
 */
export async function persistSelectedGuild(guild: ManageableGuild, userId: string): Promise<void> {
  await prisma.guild.upsert({
    where: { id: guild.id },
    create: {
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      // 実際の所有者はオーナー本人がログインしたときのみ判明する
      ownerId: guild.owner ? userId : '',
    },
    update: {
      name: guild.name,
      icon: guild.icon,
      ...(guild.owner ? { ownerId: userId } : {}),
    },
  });

  await prisma.guildMember.upsert({
    where: { guildId_userId: { guildId: guild.id, userId } },
    create: { guildId: guild.id, userId, roles: [] },
    update: {},
  });
}
