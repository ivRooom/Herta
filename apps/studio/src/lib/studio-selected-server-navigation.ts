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
