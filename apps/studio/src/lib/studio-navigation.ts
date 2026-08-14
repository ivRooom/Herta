import { isDiscordGuildId } from './guild-context-nav.ts';

export type StudioNavigationIcon =
  | 'dashboard'
  | 'server'
  | 'activity'
  | 'analytics'
  | 'community'
  | 'leaderboard'
  | 'plugin'
  | 'history'
  | 'rules'
  | 'achievement'
  | 'birthday'
  | 'daily'
  | 'lfg'
  | 'moderation'
  | 'team'
  | 'message'
  | 'xp';

export interface StudioNavigationItem {
  id: string;
  href: string;
  label: string;
  description: string;
  keywords: readonly string[];
  icon: StudioNavigationIcon;
  exact?: boolean;
}

export const STUDIO_NAV_ITEMS: readonly StudioNavigationItem[] = [
  {
    id: 'dashboard',
    href: '/dashboard',
    label: 'ダッシュボード',
    description: 'Herta Studio全体の概要を開く',
    keywords: ['home', 'overview', 'ホーム', '概要'],
    icon: 'dashboard',
    exact: true,
  },
  {
    id: 'guilds',
    href: '/dashboard/guilds',
    label: 'サーバー',
    description: '管理可能なDiscordサーバーを選択する',
    keywords: ['guild', 'server', 'discord', 'サーバー切替'],
    icon: 'server',
  },
  {
    id: 'operations',
    href: '/dashboard/operations',
    label: '稼働状況',
    description: 'Bot・データベースなどの稼働状況を確認する',
    keywords: ['operations', 'health', 'status', 'bot', 'db', '監視'],
    icon: 'activity',
  },
  {
    id: 'analytics',
    href: '/dashboard/analytics',
    label: 'アナリティクス',
    description: '利用状況とメトリクスを確認する',
    keywords: ['analytics', 'metrics', '分析', '統計'],
    icon: 'analytics',
  },
  {
    id: 'community',
    href: '/dashboard/community',
    label: 'コミュニティ',
    description: 'コミュニティ機能の状況を確認する',
    keywords: ['community', 'activity', 'コミュニティ'],
    icon: 'community',
  },
  {
    id: 'leaderboard',
    href: '/dashboard/leaderboard',
    label: 'Leaderboard',
    description: 'Leaderboardを確認する',
    keywords: ['leaderboard', 'ranking', 'rank', 'ランキング'],
    icon: 'leaderboard',
  },
  {
    id: 'custom-plugins',
    href: '/dashboard/custom-plugins',
    label: 'カスタムPlugin',
    description: 'カスタムPluginを管理する',
    keywords: ['custom plugin', 'plugin', 'プラグイン', '拡張'],
    icon: 'plugin',
  },
];

export type StudioCommandGroup = 'workspace' | 'current-server' | 'community' | 'moderation';

export const STUDIO_COMMAND_GROUP_ORDER: readonly StudioCommandGroup[] = [
  'workspace',
  'current-server',
  'community',
  'moderation',
];

export const STUDIO_COMMAND_GROUP_LABELS: Record<StudioCommandGroup, string> = {
  workspace: 'Workspace',
  'current-server': 'Current Server',
  community: 'Community Tools',
  moderation: 'Moderation',
};

export interface StudioCommandItem extends StudioNavigationItem {
  group: StudioCommandGroup;
}

type GuildCommandDefinition = Omit<StudioCommandItem, 'href'> & { path: string };

const GUILD_COMMAND_DEFINITIONS: readonly GuildCommandDefinition[] = [
  {
    id: 'guild-overview',
    path: '',
    label: 'サーバー概要',
    description: '現在のサーバーのCommunity Dashboardを開く',
    keywords: ['guild', 'server', 'overview', '概要', 'community dashboard'],
    icon: 'server',
    group: 'current-server',
    exact: true,
  },
  {
    id: 'guild-plugins',
    path: 'plugins',
    label: 'Plugin Manager',
    description: '現在のサーバーのPluginを設定する',
    keywords: ['plugin', 'plugins', 'プラグイン', '設定'],
    icon: 'plugin',
    group: 'current-server',
  },
  {
    id: 'guild-audit-logs',
    path: 'audit-logs',
    label: '監査ログ',
    description: '現在のサーバーの設定変更・操作履歴を確認する',
    keywords: ['audit', 'audit log', 'history', '監査', '履歴'],
    icon: 'history',
    group: 'current-server',
  },
  {
    id: 'guild-activity-rules-diagnostics',
    path: 'activity-rules/diagnostics',
    label: 'Activity Rules Diagnostics',
    description: 'Activity Rulesのメッセージ判定を診断する',
    keywords: ['activity rules', 'diagnostics', 'rule', 'xp', '診断', '判定'],
    icon: 'rules',
    group: 'community',
  },
  {
    id: 'guild-achievements',
    path: 'achievements',
    label: 'Achievements',
    description: '実績・称号を管理する',
    keywords: ['achievement', 'achievements', '実績', '称号', 'badge'],
    icon: 'achievement',
    group: 'community',
  },
  {
    id: 'guild-achievement-templates',
    path: 'achievements/templates',
    label: 'Achievement Templates',
    description: '実績テンプレートを管理する',
    keywords: ['achievement', 'template', 'templates', '実績', 'テンプレート'],
    icon: 'achievement',
    group: 'community',
  },
  {
    id: 'guild-achievement-operations',
    path: 'achievements/operations',
    label: 'Achievement Operations',
    description: '実績付与などの運用操作を開く',
    keywords: ['achievement', 'operations', '実績', '付与', '運用'],
    icon: 'achievement',
    group: 'community',
  },
  {
    id: 'guild-auto-response',
    path: 'auto-response',
    label: 'Auto Response',
    description: '自動返信ルールを管理する',
    keywords: ['auto response', 'reply', 'response', '自動返信', '返信'],
    icon: 'message',
    group: 'community',
  },
  {
    id: 'guild-birthday',
    path: 'birthday',
    label: 'Birthday',
    description: '誕生日登録とお祝い設定を管理する',
    keywords: ['birthday', '誕生日', 'お祝い'],
    icon: 'birthday',
    group: 'community',
  },
  {
    id: 'guild-daily-content',
    path: 'daily-content',
    label: 'Daily Content',
    description: 'Daily Contentの設定を管理する',
    keywords: ['daily', 'daily content', 'content', 'デイリー', 'コンテンツ'],
    icon: 'daily',
    group: 'community',
  },
  {
    id: 'guild-leaderboard',
    path: 'leaderboard',
    label: 'Guild Leaderboard',
    description: '現在のサーバーのLeaderboardを確認する',
    keywords: ['leaderboard', 'ranking', 'rank', 'ランキング', 'xp'],
    icon: 'leaderboard',
    group: 'community',
  },
  {
    id: 'guild-xp-operations',
    path: 'leaderboard/admin',
    label: 'XP Operations',
    description: '現在のサーバーのXPを管理する',
    keywords: ['xp', 'experience', 'admin', 'operations', '経験値', '管理'],
    icon: 'xp',
    group: 'community',
  },
  {
    id: 'guild-lfg',
    path: 'lfg',
    label: 'LFG',
    description: '募集・グループ参加機能を管理する',
    keywords: ['lfg', 'looking for group', '募集', 'グループ'],
    icon: 'lfg',
    group: 'community',
  },
  {
    id: 'guild-team-split',
    path: 'team-split',
    label: 'Team Split',
    description: 'チーム分け機能を管理する',
    keywords: ['team split', 'team', 'チーム分け', 'チーム'],
    icon: 'team',
    group: 'community',
  },
  {
    id: 'guild-quote-library',
    path: 'plugins/quote/quotes',
    label: 'Quote Library',
    description: 'Quote Pluginの登録内容を管理する',
    keywords: ['quote', 'quotes', 'plugin', '引用', '名言'],
    icon: 'message',
    group: 'community',
  },
  {
    id: 'guild-moderation',
    path: 'moderation',
    label: 'Moderation',
    description: 'モデレーション運用画面を開く',
    keywords: ['moderation', 'mod', 'モデレーション', '管理'],
    icon: 'moderation',
    group: 'moderation',
    exact: true,
  },
  {
    id: 'guild-moderation-detections',
    path: 'moderation/detections',
    label: 'Moderation Detections',
    description: 'モデレーション検知履歴を確認する',
    keywords: ['moderation', 'detections', 'detection', '検知', '履歴'],
    icon: 'moderation',
    group: 'moderation',
  },
  {
    id: 'guild-moderation-blacklist',
    path: 'moderation/blacklist',
    label: 'Moderation Blacklist',
    description: 'Blacklistを管理する',
    keywords: ['moderation', 'blacklist', 'block', 'ブラックリスト', '禁止'],
    icon: 'moderation',
    group: 'moderation',
  },
  {
    id: 'guild-moderation-enforcement',
    path: 'moderation/enforcement',
    label: 'Moderation Enforcement',
    description: 'モデレーションのEnforcement設定を管理する',
    keywords: ['moderation', 'enforcement', 'action', '執行', '対応'],
    icon: 'moderation',
    group: 'moderation',
  },
];

export function buildStudioCommandItems(
  guildId: string | null,
  guildName: string | null,
): StudioCommandItem[] {
  const workspace = STUDIO_NAV_ITEMS.map((item) => ({ ...item, group: 'workspace' as const }));
  if (!guildId || !isDiscordGuildId(guildId)) return workspace;

  const baseHref = `/dashboard/guilds/${guildId}`;
  return [
    ...workspace,
    ...GUILD_COMMAND_DEFINITIONS.map(({ path, description, ...item }) => ({
      ...item,
      href: path ? `${baseHref}/${path}` : baseHref,
      description: guildName ? `${guildName}: ${description}` : description,
    })),
  ];
}

export function filterStudioCommandItems(
  items: readonly StudioCommandItem[],
  query: string,
): StudioCommandItem[] {
  const tokens = normalizeSearchValue(query).split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [...items];

  return items.filter((item) => {
    const searchText = normalizeSearchValue(
      [item.label, item.description, item.href, ...item.keywords].join(' '),
    );
    return tokens.every((token) => searchText.includes(token));
  });
}

function normalizeSearchValue(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja').trim();
}
