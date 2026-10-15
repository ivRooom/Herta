import { cache } from 'react';
import { prisma } from '@/lib/db';
import { fetchManageableGuilds, type ManageableGuild } from '@/lib/discord';
import { buildGuildPersistenceData } from '@/lib/guild-metadata';

/**
 * ダッシュボードはサイドバー遷移・タブ切り替え(searchParams変更)のたびに
 * layout.tsx + page.tsxの両方からこの一覧取得を呼び出すため、Discord側の
 * `/users/@me/guilds` への実アクセスを12秒だけ短期キャッシュする。
 * accessTokenをキー引数に含めるためユーザーをまたいだキャッシュ汚染は起きない。
 *
 * `next/cache`の`unstable_cache`はstale-while-revalidateのため、TTLを過ぎても
 * 再検証が完了するまで古い値を返し続けてしまい、権限剥奪の反映が12秒を超えて
 * 遅れる可能性がある(認可判断に使うには不適切)。ここではTTLを過ぎたら必ず
 * 同期的に再取得してブロックする、素朴なハードTTLキャッシュを自前で持つ。
 */
const GUILD_CACHE_TTL_MS = 12_000;
const GUILD_CACHE_MAX_ENTRIES = 500;

interface GuildCacheEntry {
  guilds: ManageableGuild[];
  expiresAt: number;
}

const guildCacheByAccessToken = new Map<string, GuildCacheEntry>();

async function getManageableGuildsWithHardTtlCache(
  accessToken: string,
): Promise<ManageableGuild[]> {
  const now = Date.now();
  const cached = guildCacheByAccessToken.get(accessToken);
  if (cached && cached.expiresAt > now) {
    return cached.guilds;
  }

  const guilds = await fetchManageableGuilds(accessToken);

  if (guildCacheByAccessToken.size >= GUILD_CACHE_MAX_ENTRIES) {
    const oldestKey = guildCacheByAccessToken.keys().next().value;
    if (oldestKey !== undefined) guildCacheByAccessToken.delete(oldestKey);
  }
  guildCacheByAccessToken.set(accessToken, { guilds, expiresAt: now + GUILD_CACHE_TTL_MS });
  return guilds;
}

/** 同一Server Componentsレンダー内(layout.tsx + page.tsx)でも呼び出しを共有する。 */
const getManageableGuildsForRequest = cache(getManageableGuildsWithHardTtlCache);

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
