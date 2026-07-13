import { prisma } from '@/lib/db';
import { fetchManageableGuilds, type ManageableGuild } from '@/lib/discord';
import { buildGuildPersistenceData } from '@/lib/guild-metadata';

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
 * 選択された Guild のうち、OAuth APIから確実に取得できる情報だけをDBへ保存する。
 * 呼び出し元で管理権限を検証済みであることを前提とする。
 *
 * `/users/@me/guilds` では、ログインユーザー自身のrole、nickname、joinedAtや、
 * ownerでない場合の実owner IDは取得できない。これらを空値で推測保存すると
 * 将来のRBAC・監査で誤判定を起こすため、GuildMemberはBot同期側の責務とする。
 */
export async function persistSelectedGuild(guild: ManageableGuild, userId: string): Promise<void> {
  const data = buildGuildPersistenceData(guild, userId);

  await prisma.guild.upsert({
    where: { id: guild.id },
    create: data.create,
    update: data.update,
  });
}
