import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db';
import { fetchManageableGuilds, type ManageableGuild } from '@/lib/discord';
import { buildGuildPersistenceData } from '@/lib/guild-metadata';

/**
 * ダッシュボードはサイドバー遷移・タブ切り替え(searchParams変更)のたびに
 * layout.tsx + page.tsxの両方からこの一覧取得を呼び出すため、Discord側の
 * `/users/@me/guilds` への実アクセスを12秒だけ短期キャッシュする。
 * accessTokenをキー引数に含めるためユーザーをまたいだキャッシュ汚染は起きない。
 * 権限剥奪(Kick・Role変更等)の反映が最大12秒遅れるが、ユーザー判断により
 * 画面遷移の速度を優先してこの遅延を許容する設計とした。
 */
const getManageableGuildsCached = unstable_cache(
  (accessToken: string) => fetchManageableGuilds(accessToken),
  ['studio-manageable-guilds'],
  { revalidate: 12 },
);

/** 同一Server Componentsレンダー内(layout.tsx + page.tsx)でも呼び出しを共有する。 */
const getManageableGuildsForRequest = cache(getManageableGuildsCached);

/** ログインユーザーが管理可能な Guild 一覧を取得する */
export async function getManageableGuilds(accessToken: string): Promise<ManageableGuild[]> {
  return getManageableGuildsForRequest(accessToken);
}

/**
 * 指定した Guild をログインユーザーが管理可能か確認し、その Guild を返す。
 * 管理権限が無い場合は null を返す (権限のない Guild へのアクセスを防ぐ)。
 */
export async function getManageableGuild(
  accessToken: string,
  guildId: string,
): Promise<ManageableGuild | null> {
  const guilds = await getManageableGuilds(accessToken);
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
