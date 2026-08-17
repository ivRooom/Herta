import { isDiscordGuildId } from './guild-context-nav.ts';
import type { StudioNavigationIcon } from './studio-navigation.ts';

export interface SelectedServerNavigationItem {
  id: string;
  href: string;
  label: string;
  description: string;
  icon: StudioNavigationIcon;
  exact?: boolean;
}

type SelectedServerNavigationDefinition = Omit<SelectedServerNavigationItem, 'href'> & {
  path: string;
};

const SELECTED_SERVER_NAVIGATION_DEFINITIONS: readonly SelectedServerNavigationDefinition[] = [
  {
    id: 'selected-server-overview',
    path: '',
    label: '概要',
    description: '選択中サーバーのコンソールを開く',
    icon: 'server',
    exact: true,
  },
  {
    id: 'selected-server-message-studio',
    path: 'daily-content',
    label: 'Botで発言',
    description: 'Bot発言・Forum・予約投稿・定期投稿を作成する',
    icon: 'message',
  },
  {
    id: 'selected-server-commands',
    path: 'commands',
    label: 'コマンド',
    description: 'Discordへ登録済みのSlash Commandと使い方を確認する',
    icon: 'rules',
  },
  {
    id: 'selected-server-role-manager',
    path: 'roles',
    label: 'Role Manager',
    description: 'Studioの閲覧・編集・操作権限をDiscord Roleごとに管理する',
    icon: 'rules',
  },
  {
    id: 'selected-server-plugins',
    path: 'plugins',
    label: 'プラグイン',
    description: '選択中サーバーのPluginを管理する',
    icon: 'plugin',
  },
  {
    id: 'selected-server-leaderboard',
    path: 'leaderboard',
    label: 'Leaderboard',
    description: '選択中サーバーのランキングを確認する',
    icon: 'leaderboard',
  },
  {
    id: 'selected-server-moderation',
    path: 'moderation',
    label: 'Moderation',
    description: '選択中サーバーのモデレーションを管理する',
    icon: 'moderation',
  },
  {
    id: 'selected-server-audit-logs',
    path: 'audit-logs',
    label: '監査ログ',
    description: '選択中サーバーの操作履歴を確認する',
    icon: 'history',
  },
  {
    id: 'selected-server-bot-profile',
    path: 'bot-profile',
    label: 'Botプロフィール',
    description: '選択中サーバーで表示するBotプロフィールを管理する',
    icon: 'account',
  },
];

export function buildSelectedServerNavigationItems(
  guildId: string | null,
): SelectedServerNavigationItem[] {
  if (!guildId || !isDiscordGuildId(guildId)) return [];

  const baseHref = `/dashboard/guilds/${guildId}`;
  return SELECTED_SERVER_NAVIGATION_DEFINITIONS.map(({ path, ...item }) => ({
    ...item,
    href: path ? `${baseHref}/${path}` : baseHref,
  }));
}
