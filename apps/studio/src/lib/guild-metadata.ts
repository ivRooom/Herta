import type { ManageableGuild } from './discord';

export interface GuildPersistenceData {
  create: {
    id: string;
    name: string;
    icon: string | null;
    ownerId: string | null;
  };
  update: {
    name: string;
    icon: string | null;
    ownerId?: string;
  };
}

/**
 * OAuthの /users/@me/guilds で確実に分かる情報だけを永続化する。
 * owner=false の場合、実際のowner IDは取得できないためNULLを保存し、推測しない。
 */
export function buildGuildPersistenceData(
  guild: ManageableGuild,
  userId: string,
): GuildPersistenceData {
  return {
    create: {
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      ownerId: guild.owner ? userId : null,
    },
    update: {
      name: guild.name,
      icon: guild.icon,
      ...(guild.owner ? { ownerId: userId } : {}),
    },
  };
}
