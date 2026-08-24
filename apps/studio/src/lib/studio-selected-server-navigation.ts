import { isDiscordGuildId } from './guild-context-nav.ts';
import {
  STUDIO_PINNABLE_SERVER_TABS,
  type StudioPinnableServerTabId,
} from './studio-navigation-config.ts';
import type { StudioNavigationIcon } from './studio-navigation.ts';

export interface SelectedServerNavigationItem {
  id: string;
  href: string;
  label: string;
  description: string;
  icon: StudioNavigationIcon;
  exact?: boolean;
}

type CoreServerNavigationDefinition = Omit<SelectedServerNavigationItem, 'href'> & {
  href: (guildId: string) => string;
};

const CORE_SERVER_NAVIGATION_DEFINITIONS: readonly CoreServerNavigationDefinition[] = [
  {
    id: 'selected-server-overview',
    href: (guildId) => `/dashboard/guilds/${guildId}`,
    label: 'Overview',
    description: '選択中サーバーのコンソールを開く',
    icon: 'server',
    exact: true,
  },
  {
    id: 'selected-server-plugins',
    href: (guildId) => `/dashboard/guilds/${guildId}/plugins`,
    label: 'Plugins',
    description: '選択中サーバーのPluginを管理する',
    icon: 'plugin',
  },
  {
    id: 'selected-server-commands',
    href: (guildId) => `/dashboard/guilds/${guildId}/commands`,
    label: 'Commands',
    description: 'Discordへ登録済みのSlash Commandと使い方を確認する',
    icon: 'rules',
  },
  {
    id: 'selected-server-community',
    href: (guildId) => `/dashboard/community?guild=${guildId}`,
    label: 'Community',
    description: '選択中サーバーのCommunity機能と活動状況を確認する',
    icon: 'community',
    exact: true,
  },
  {
    id: 'selected-server-moderation',
    href: (guildId) => `/dashboard/guilds/${guildId}/moderation`,
    label: 'Moderation',
    description: '選択中サーバーのモデレーションを管理する',
    icon: 'moderation',
  },
  {
    id: 'selected-server-analytics',
    href: (guildId) => `/dashboard/analytics?guild=${guildId}`,
    label: 'Analytics / Insights',
    description: '選択中サーバーの利用状況とInsightsを確認する',
    icon: 'analytics',
    exact: true,
  },
];

export function buildSelectedServerNavigationItems(
  guildId: string | null,
  visiblePluginTabIds: readonly StudioPinnableServerTabId[] = [],
): SelectedServerNavigationItem[] {
  if (!guildId || !isDiscordGuildId(guildId)) return [];

  const coreItems = CORE_SERVER_NAVIGATION_DEFINITIONS.map(({ href, ...item }) => ({
    ...item,
    href: href(guildId),
  }));
  const visible = new Set(visiblePluginTabIds);
  const pluginItems = STUDIO_PINNABLE_SERVER_TABS.filter((tab) => visible.has(tab.id)).map(
    (tab) => ({
      id: `selected-server-plugin-${tab.id}`,
      href: `/dashboard/guilds/${guildId}/${tab.path}`,
      label: tab.label,
      description: tab.description,
      icon: tab.icon,
    }),
  );

  return [...coreItems, ...pluginItems];
}
