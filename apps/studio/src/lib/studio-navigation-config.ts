import type { StudioNavigationIcon } from './studio-navigation.ts';

export const STUDIO_PINNABLE_SERVER_TABS = [
  {
    id: 'message-studio',
    label: 'Message Studio',
    description: 'Bot発言・予約投稿・定期投稿を管理する',
    path: 'daily-content',
    icon: 'message',
  },
  {
    id: 'role-manager',
    label: 'Role Manager',
    description: 'Discord RoleとSelf Roleを管理する',
    path: 'roles',
    icon: 'rules',
  },
  {
    id: 'bot-profile',
    label: 'Botプロフィール',
    description: 'サーバーごとのBotプロフィールを管理する',
    path: 'bot-profile',
    icon: 'account',
  },
  {
    id: 'achievements',
    label: 'Achievements',
    description: '実績・称号を管理する',
    path: 'achievements',
    icon: 'achievement',
  },
  {
    id: 'auto-response',
    label: 'Auto Response',
    description: '自動返信ルールを管理する',
    path: 'auto-response',
    icon: 'message',
  },
  {
    id: 'birthday',
    label: 'Birthday',
    description: '誕生日登録・Birthday Cardを管理する',
    path: 'birthday',
    icon: 'birthday',
  },
  {
    id: 'lfg',
    label: 'LFG',
    description: '募集・グループ参加機能を管理する',
    path: 'lfg',
    icon: 'lfg',
  },
  {
    id: 'team-split',
    label: 'Team Split',
    description: 'チーム分け機能を管理する',
    path: 'team-split',
    icon: 'team',
  },
  {
    id: 'quote-library',
    label: 'Quote Library',
    description: 'Quote Pluginの登録内容を管理する',
    path: 'plugins/quote/quotes',
    icon: 'message',
  },
  {
    id: 'xp-operations',
    label: 'XP Operations',
    description: 'メンバーのXPを管理する',
    path: 'leaderboard/admin',
    icon: 'xp',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: StudioNavigationIcon;
}[];

export type StudioPinnableServerTabId = (typeof STUDIO_PINNABLE_SERVER_TABS)[number]['id'];

export interface StudioNavigationConfig {
  visiblePluginTabIds: StudioPinnableServerTabId[];
}

export interface StudioNavigationPatchResult {
  ok: true;
  value: StudioNavigationConfig;
}

export interface StudioNavigationPatchError {
  ok: false;
  error: string;
}

const PINNABLE_TAB_IDS = new Set<string>(STUDIO_PINNABLE_SERVER_TABS.map((tab) => tab.id));
const EMPTY_CONFIG: StudioNavigationConfig = { visiblePluginTabIds: [] };

export function parseStoredStudioNavigationConfig(settingsJson: unknown): StudioNavigationConfig {
  if (!isRecord(settingsJson)) return { ...EMPTY_CONFIG };
  const navigation = settingsJson['studioNavigation'];
  if (!isRecord(navigation)) return { ...EMPTY_CONFIG };
  const value = navigation['visiblePluginTabIds'];
  if (!Array.isArray(value)) return { ...EMPTY_CONFIG };

  return {
    visiblePluginTabIds: normalizeStudioPluginTabIds(value),
  };
}

export function parseStudioNavigationPatch(
  value: unknown,
): StudioNavigationPatchResult | StudioNavigationPatchError {
  if (!isRecord(value)) return { ok: false, error: '更新内容が不正です' };
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'visiblePluginTabIds') {
    return { ok: false, error: '更新可能なのは表示するPluginタブだけです' };
  }

  const ids = value['visiblePluginTabIds'];
  if (!Array.isArray(ids)) return { ok: false, error: 'Pluginタブ一覧が不正です' };
  if (ids.length > STUDIO_PINNABLE_SERVER_TABS.length) {
    return { ok: false, error: 'Pluginタブの件数が上限を超えています' };
  }
  if (ids.some((id) => typeof id !== 'string' || !PINNABLE_TAB_IDS.has(id))) {
    return { ok: false, error: '未対応のPluginタブが含まれています' };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'Pluginタブが重複しています' };
  }

  return {
    ok: true,
    value: { visiblePluginTabIds: normalizeStudioPluginTabIds(ids) },
  };
}

/**
 * 表示設定と権限を分離するための境界。
 * 現在はGuild設定だけを使用し、将来admin.ivrm.jp等からroleAllowedTabIdsを
 * 受け取る場合はここでintersectionを取る。これはauthorizationの代替ではない。
 */
export function resolveEffectiveStudioPluginTabIds(
  configuredTabIds: readonly StudioPinnableServerTabId[],
  roleAllowedTabIds?: readonly StudioPinnableServerTabId[] | null,
): StudioPinnableServerTabId[] {
  const configured = normalizeStudioPluginTabIds(configuredTabIds);
  if (!roleAllowedTabIds) return configured;
  const allowed = new Set(normalizeStudioPluginTabIds(roleAllowedTabIds));
  return configured.filter((id) => allowed.has(id));
}

export function studioNavigationSettingsResource(guildId: string): string {
  return `guild:${encodeURIComponent(guildId.trim())}:studio-navigation`;
}

function normalizeStudioPluginTabIds(values: readonly unknown[]): StudioPinnableServerTabId[] {
  const requested = new Set(
    values.filter(
      (value): value is StudioPinnableServerTabId =>
        typeof value === 'string' && PINNABLE_TAB_IDS.has(value),
    ),
  );
  return STUDIO_PINNABLE_SERVER_TABS.map((tab) => tab.id).filter((id) => requested.has(id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
