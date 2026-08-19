import { isDiscordGuildId } from './guild-context-nav.ts';

export const STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH = 100;
export const STUDIO_COMMAND_SEARCH_RESULT_LIMIT = 20;

export type StudioNavigationIcon =
  | 'dashboard'
  | 'server'
  | 'activity'
  | 'analytics'
  | 'community'
  | 'leaderboard'
  | 'plugin'
  | 'custom-plugin'
  | 'history'
  | 'rules'
  | 'achievement'
  | 'birthday'
  | 'daily'
  | 'lfg'
  | 'moderation'
  | 'team'
  | 'message'
  | 'xp'
  | 'account';

export interface StudioNavigationItem {
  id: string;
  href: string;
  label: string;
  description: string;
  keywords: readonly string[];
  /**
   * Command Palette向けの安全な意図表現。
   * navigation metadataだけを保持し、Discord本文・Secret・ユーザー生成データは含めない。
   */
  intents?: readonly string[];
  icon: StudioNavigationIcon;
  exact?: boolean;
}

export const STUDIO_ACCOUNT_NAV_ITEM = {
  id: 'account',
  href: '/dashboard/account',
  label: 'アカウント',
  description: 'Discord連携とStudioセッションを確認する',
  keywords: ['account', 'profile', 'settings', 'discord', 'アカウント', 'プロフィール', '設定'],
  intents: ['Discord連携を確認したい', 'ログイン状態を確認したい'],
  icon: 'account',
} as const satisfies StudioNavigationItem;

export const STUDIO_NAV_ITEMS: readonly StudioNavigationItem[] = [
  {
    id: 'dashboard',
    href: '/dashboard',
    label: 'ダッシュボード',
    description: 'Herta Studio全体の概要を開く',
    keywords: ['home', 'overview', 'ホーム', '概要'],
    intents: ['Studio全体を確認したい', 'ホームに戻りたい'],
    icon: 'dashboard',
    exact: true,
  },
  {
    id: 'guilds',
    href: '/dashboard/guilds',
    label: 'サーバー',
    description: '管理可能なDiscordサーバーを選択する',
    keywords: ['guild', 'server', 'discord', 'サーバー切替'],
    intents: ['別のサーバーに切り替えたい', '管理するサーバーを選びたい'],
    icon: 'server',
  },
  {
    id: 'plugins',
    href: '/dashboard/plugins',
    label: 'プラグイン管理',
    description: '管理可能なサーバーのPlugin状態を横断して確認する',
    keywords: ['plugin', 'plugins', 'plugin manager', 'プラグイン', 'プラグイン管理', '設定'],
    intents: ['機能をまとめて確認したい', 'プラグインの状態を確認したい'],
    icon: 'plugin',
  },
  {
    id: 'operations',
    href: '/dashboard/operations',
    label: '稼働状況',
    description: 'Bot・データベースなどの稼働状況を確認する',
    keywords: ['operations', 'health', 'status', 'bot', 'db', '監視'],
    intents: [
      'Botが動いているか確認したい',
      '障害や稼働状況を確認したい',
      'サービスの状態を確認したい',
    ],
    icon: 'activity',
  },
  {
    id: 'analytics',
    href: '/dashboard/analytics',
    label: 'アナリティクス',
    description: '利用状況とメトリクスを確認する',
    keywords: ['analytics', 'metrics', '分析', '統計'],
    intents: ['利用状況を分析したい', 'メトリクスを見たい'],
    icon: 'analytics',
  },
  {
    id: 'community',
    href: '/dashboard/community',
    label: 'コミュニティ',
    description: 'コミュニティ機能の状況を確認する',
    keywords: ['community', 'activity', 'コミュニティ'],
    intents: ['コミュニティの活動を確認したい'],
    icon: 'community',
  },
  {
    id: 'leaderboard',
    href: '/dashboard/leaderboard',
    label: 'Leaderboard',
    description: 'Leaderboardを確認する',
    keywords: ['leaderboard', 'ranking', 'rank', 'ランキング'],
    intents: ['ランキングを見たい'],
    icon: 'leaderboard',
  },
  {
    id: 'custom-plugins',
    href: '/dashboard/custom-plugins',
    label: 'カスタムPlugin',
    description: 'カスタムPluginを管理する',
    keywords: ['custom plugin', 'plugin', 'プラグイン', '拡張'],
    intents: ['独自機能を追加したい', 'カスタム機能を管理したい'],
    icon: 'custom-plugin',
  },
  STUDIO_ACCOUNT_NAV_ITEM,
];

export type StudioCommandGroup = 'workspace' | 'current-server' | 'community' | 'moderation';

export const STUDIO_COMMAND_GROUP_ORDER: readonly StudioCommandGroup[] = [
  'current-server',
  'community',
  'moderation',
  'workspace',
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
    intents: ['このサーバーの概要を確認したい'],
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
    intents: ['このサーバーの機能を設定したい', 'プラグインを有効化したい'],
    icon: 'plugin',
    group: 'current-server',
  },
  {
    id: 'guild-audit-logs',
    path: 'audit-logs',
    label: '監査ログ',
    description: '現在のサーバーの設定変更・操作履歴を確認する',
    keywords: ['audit', 'audit log', 'history', '監査', '履歴'],
    intents: ['誰が設定を変更したか確認したい', '操作履歴を見たい'],
    icon: 'history',
    group: 'current-server',
  },
  {
    id: 'guild-activity-rules-diagnostics',
    path: 'activity-rules/diagnostics',
    label: 'Activity Rules Diagnostics',
    description: 'Activity Rulesのメッセージ判定を診断する',
    keywords: ['activity rules', 'diagnostics', 'rule', 'xp', '診断', '判定'],
    intents: ['メッセージのXP判定を診断したい', 'Activity Rulesが動かない原因を調べたい'],
    icon: 'rules',
    group: 'community',
  },
  {
    id: 'guild-achievements',
    path: 'achievements',
    label: 'Achievements',
    description: '実績・称号を管理する',
    keywords: ['achievement', 'achievements', '実績', '称号', 'badge'],
    intents: ['実績や称号を管理したい'],
    icon: 'achievement',
    group: 'community',
  },
  {
    id: 'guild-achievement-templates',
    path: 'achievements/templates',
    label: 'Achievement Templates',
    description: '実績テンプレートを管理する',
    keywords: ['achievement', 'template', 'templates', '実績', 'テンプレート'],
    intents: ['実績テンプレートを作りたい'],
    icon: 'achievement',
    group: 'community',
  },
  {
    id: 'guild-achievement-operations',
    path: 'achievements/operations',
    label: 'Achievement Operations',
    description: '実績付与などの運用操作を開く',
    keywords: ['achievement', 'operations', '実績', '付与', '運用'],
    intents: ['メンバーに実績を付与したい'],
    icon: 'achievement',
    group: 'community',
  },
  {
    id: 'guild-auto-response',
    path: 'auto-response',
    label: 'Auto Response',
    description: '自動返信ルールを管理する',
    keywords: ['auto response', 'reply', 'response', '自動返信', '返信'],
    intents: ['自動で返信したい', '特定の言葉にBotを反応させたい'],
    icon: 'message',
    group: 'community',
  },
  {
    id: 'guild-birthday',
    path: 'birthday',
    label: 'Birthday',
    description: '誕生日登録とお祝い設定を管理する',
    keywords: ['birthday', '誕生日', 'お祝い'],
    intents: ['誕生日のお祝いを設定したい', '誕生日カードを設定したい'],
    icon: 'birthday',
    group: 'community',
  },
  {
    id: 'guild-daily-content',
    path: 'daily-content',
    label: 'Message Studio',
    description: 'Bot発言・お知らせ・予約投稿・定期投稿を作成する',
    keywords: [
      'message studio',
      'bot message',
      'announce',
      'say',
      'scheduled post',
      'recurring post',
      'forum',
      'daily content',
      'Bot発言',
      'お知らせ',
      '予約投稿',
      '定期投稿',
      'フォーラム',
    ],
    intents: [
      'Botで予約投稿したい',
      'メッセージを予約したい',
      '定期的に投稿したい',
      'お知らせを送りたい',
      'Botに発言させたい',
    ],
    icon: 'message',
    group: 'current-server',
  },
  {
    id: 'guild-leaderboard',
    path: 'leaderboard',
    label: 'Guild Leaderboard',
    description: '現在のサーバーのLeaderboardを確認する',
    keywords: ['leaderboard', 'ranking', 'rank', 'ランキング', 'xp'],
    intents: ['このサーバーのランキングを見たい'],
    icon: 'leaderboard',
    group: 'community',
  },
  {
    id: 'guild-xp-operations',
    path: 'leaderboard/admin',
    label: 'XP Operations',
    description: '現在のサーバーのXPを管理する',
    keywords: ['xp', 'experience', 'admin', 'operations', '経験値', '管理'],
    intents: ['メンバーのXPを変更したい', '経験値を管理したい'],
    icon: 'xp',
    group: 'community',
  },
  {
    id: 'guild-lfg',
    path: 'lfg',
    label: 'LFG',
    description: '募集・グループ参加機能を管理する',
    keywords: ['lfg', 'looking for group', '募集', 'グループ'],
    intents: ['メンバー募集を管理したい', '一緒に遊ぶ人を募集したい'],
    icon: 'lfg',
    group: 'community',
  },
  {
    id: 'guild-team-split',
    path: 'team-split',
    label: 'Team Split',
    description: 'チーム分け機能を管理する',
    keywords: ['team split', 'team', 'チーム分け', 'チーム'],
    intents: ['チームをランダムに分けたい', 'メンバーをチーム分けしたい'],
    icon: 'team',
    group: 'community',
  },
  {
    id: 'guild-quote-library',
    path: 'plugins/quote/quotes',
    label: 'Quote Library',
    description: 'Quote Pluginの登録内容を管理する',
    keywords: ['quote', 'quotes', 'plugin', '引用', '名言'],
    intents: ['名言や引用を管理したい'],
    icon: 'message',
    group: 'community',
  },
  {
    id: 'guild-moderation',
    path: 'moderation',
    label: 'Moderation',
    description: 'モデレーション運用画面を開く',
    keywords: ['moderation', 'mod', 'モデレーション', '管理'],
    intents: ['荒らし対策を管理したい', 'サーバーをモデレーションしたい'],
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
    intents: ['危険な投稿の検知履歴を見たい', 'モデレーションの検知結果を確認したい'],
    icon: 'moderation',
    group: 'moderation',
  },
  {
    id: 'guild-moderation-blacklist',
    path: 'moderation/blacklist',
    label: 'Moderation Blacklist',
    description: 'Blacklistを管理する',
    keywords: ['moderation', 'blacklist', 'block', 'ブラックリスト', '禁止'],
    intents: ['禁止ユーザーを管理したい', 'ブラックリストを設定したい'],
    icon: 'moderation',
    group: 'moderation',
  },
  {
    id: 'guild-moderation-enforcement',
    path: 'moderation/enforcement',
    label: 'Moderation Enforcement',
    description: 'モデレーションのEnforcement設定を管理する',
    keywords: ['moderation', 'enforcement', 'action', '執行', '対応'],
    intents: [
      'サーバーの危険な設定を確認したい',
      'モデレーションの対応方法を設定したい',
      '自動対応を設定したい',
    ],
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
  const guildCommands = GUILD_COMMAND_DEFINITIONS.map(({ path, description, ...item }) => ({
    ...item,
    href: path ? `${baseHref}/${path}` : baseHref,
    description: guildName ? `${guildName}: ${description}` : description,
  }));

  return [...guildCommands, ...workspace];
}

export function filterStudioCommandItems(
  items: readonly StudioCommandItem[],
  query: string,
): StudioCommandItem[] {
  const normalizedQuery = normalizeSearchValue(query).slice(0, STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH);
  const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [...items];

  return items
    .map((item, index) => ({ item, index, score: scoreStudioCommandItem(item, normalizedQuery, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, STUDIO_COMMAND_SEARCH_RESULT_LIMIT)
    .map((entry) => entry.item);
}

function scoreStudioCommandItem(
  item: StudioCommandItem,
  query: string,
  tokens: readonly string[],
): number {
  const label = normalizeSearchValue(item.label);
  const href = normalizeSearchValue(item.href);
  const description = normalizeSearchValue(item.description);
  const keywords = item.keywords.map(normalizeSearchValue);
  const intents = (item.intents ?? []).map(normalizeSearchValue);
  const lexicalFields = [label, description, href, ...keywords];
  const lexicalText = lexicalFields.join(' ');
  const intentText = intents.join(' ');

  if (label === query) return 700;
  if (keywords.some((keyword) => keyword === query)) return 650;
  if (label.startsWith(query)) return 600;
  if (keywords.some((keyword) => keyword.startsWith(query))) return 550;
  if (lexicalFields.some((field) => field.includes(query))) return 500;
  if (tokens.every((token) => lexicalText.includes(token))) return 450;

  if (intents.some((intent) => intent === query)) return 300;
  if (intents.some((intent) => intent.startsWith(query) || query.startsWith(intent))) return 250;
  if (intents.some((intent) => intent.includes(query) || query.includes(intent))) return 225;
  if (tokens.every((token) => intentText.includes(token))) return 200;

  return 0;
}

function normalizeSearchValue(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja').trim();
}
