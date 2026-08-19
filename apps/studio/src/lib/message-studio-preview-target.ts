import type { GuildChannelOption } from './bot-guild-options.ts';

/**
 * Message StudioのPreviewに表示する投稿先を解決する。
 * 通常catalogを正本とし、on-demand取得したarchived Threadは同じ選択IDのときだけfallbackする。
 */
export function resolveMessageStudioPreviewTarget(
  channels: GuildChannelOption[],
  channelId: string,
  resolvedTarget: GuildChannelOption | null,
): GuildChannelOption | null {
  if (!channelId) return null;
  return (
    channels.find((channel) => channel.id === channelId) ??
    (resolvedTarget?.id === channelId ? resolvedTarget : null)
  );
}
