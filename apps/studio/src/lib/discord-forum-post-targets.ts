import type { GuildChannelOption } from './bot-guild-options.ts';

export interface DiscordForumPostTargetSelection {
  primaryChannelId: string | null;
  forumId: string | null;
  threadId: string | null;
  threads: GuildChannelOption[];
}

/**
 * Forum配下のThreadを親Forumへまとめて表示するための選択状態を解決する。
 * 実際の送信先は既存Thread選択時もThread IDのまま維持し、送信側のGuild検証を再利用する。
 */
export function resolveDiscordForumPostTargetSelection(
  options: GuildChannelOption[],
  value: string | null,
): DiscordForumPostTargetSelection {
  if (!value) {
    return { primaryChannelId: null, forumId: null, threadId: null, threads: [] };
  }

  const selected = options.find((option) => option.id === value);
  if (!selected) {
    return { primaryChannelId: value, forumId: null, threadId: null, threads: [] };
  }

  const forum =
    selected.kind === 'forum'
      ? selected
      : selected.kind === 'thread' && selected.parentId
        ? options.find((option) => option.id === selected.parentId && option.kind === 'forum')
        : undefined;

  if (!forum) {
    return {
      primaryChannelId: selected.id,
      forumId: null,
      threadId: null,
      threads: [],
    };
  }

  const threads = options.filter(
    (option) => option.kind === 'thread' && option.parentId === forum.id && option.viewable,
  );

  return {
    primaryChannelId: forum.id,
    forumId: forum.id,
    threadId: selected.kind === 'thread' ? selected.id : null,
    threads,
  };
}
