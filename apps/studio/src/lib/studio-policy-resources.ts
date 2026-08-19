import type { StudioAccessPolicy, StudioPolicyAction } from './studio-access-policy.ts';
import {
  pluginConfigFieldResource,
  pluginEnabledControlResource,
} from './studio-plugin-permissions.ts';

export const STUDIO_PAGE_DEFINITIONS = [
  {
    id: 'message-studio',
    label: 'Botで発言',
    description: 'Message Studio、予約投稿、定期投稿を閲覧',
  },
  { id: 'commands', label: 'コマンド', description: 'Slash Command一覧・利用状況を閲覧' },
  { id: 'roles', label: 'Role Manager', description: 'Discord Role Lifecycle画面を閲覧' },
  { id: 'access', label: 'Access Control', description: 'Herta IAM / Access Control Centerを閲覧' },
  { id: 'plugins', label: 'プラグイン', description: 'Plugin一覧・Plugin設定画面を閲覧' },
  { id: 'leaderboard', label: 'Leaderboard', description: 'Guildランキングを閲覧' },
  {
    id: 'birthday',
    label: 'Birthday Management',
    description: 'メンバー誕生日・生年・祝い実績・Birthday Cardを閲覧',
  },
  {
    id: 'moderation',
    label: 'Moderation',
    description: 'Case・自動検知・自動対応の管理画面を閲覧',
  },
  { id: 'audit-logs', label: '監査ログ', description: 'Guildの監査ログを閲覧' },
  {
    id: 'bot-profile',
    label: 'Botプロフィール',
    description: 'GuildごとのBotプロフィール設定を閲覧',
  },
] as const;

export type StudioPageId = (typeof STUDIO_PAGE_DEFINITIONS)[number]['id'];

export interface StudioGranularPermissionOption {
  id: string;
  category: string;
  label: string;
  description: string;
  action: StudioPolicyAction;
  resource: string;
}

export interface PluginPermissionCatalogInput {
  id: string;
  name: string;
  configSchema: Record<string, unknown>;
}

export interface ApplicableStudioPolicyContext {
  roleIds: readonly string[];
  policies: readonly { discordRoleId: string; policy: StudioAccessPolicy }[];
  managedPolicies: readonly StudioAccessPolicy[];
}

export function studioPageResource(guildId: string, pageId: StudioPageId): string {
  return `guild:${guildId}:page:${encodeSegment(pageId)}`;
}

export function studioAccessPageResource(
  guildId: string,
  page: 'overview' | 'users' | 'groups' | 'roles' | 'policies',
): string {
  return `guild:${guildId}:access:${page}`;
}

export type StudioBirthdayResource =
  | 'registrations'
  | 'celebrations'
  | 'card-background'
  | 'card-test-send';

export function studioBirthdayResource(guildId: string, resource: StudioBirthdayResource): string {
  return `guild:${guildId}:birthday:${encodeSegment(resource)}`;
}

export function studioBotProfileSettingResource(guildId: string, setting: 'anniversary'): string {
  return `guild:${guildId}:bot-profile:setting:${encodeSegment(setting)}`;
}

export function hasConfiguredStudioPagePolicy(access: ApplicableStudioPolicyContext): boolean {
  const activeRoleIds = new Set(access.roleIds);
  const policies = [
    ...access.managedPolicies,
    ...access.policies
      .filter((policy) => activeRoleIds.has(policy.discordRoleId))
      .map((policy) => policy.policy),
  ];
  return policies.some((policy) =>
    policy.Statement.some((statement) => statement.Action.some(isPageViewActionPattern)),
  );
}

export function buildStudioGranularPermissionOptions(
  guildId: string,
  plugins: readonly PluginPermissionCatalogInput[],
): StudioGranularPermissionOption[] {
  const options: StudioGranularPermissionOption[] = STUDIO_PAGE_DEFINITIONS.map((page) => ({
    id: permissionOptionId('studio.page.view', studioPageResource(guildId, page.id)),
    category: 'Pages',
    label: page.label,
    description: page.description,
    action: 'studio.page.view',
    resource: studioPageResource(guildId, page.id),
  }));

  for (const page of ['overview', 'users', 'groups', 'roles', 'policies'] as const) {
    const resource = studioAccessPageResource(guildId, page);
    options.push({
      id: permissionOptionId('studio.roles.read', resource),
      category: 'Access Control',
      label: accessPageLabel(page),
      description: `Access Controlの${accessPageLabel(page)}を閲覧`,
      action: 'studio.roles.read',
      resource,
    });
  }

  const birthdayRegistrations = studioBirthdayResource(guildId, 'registrations');
  const birthdayCelebrations = studioBirthdayResource(guildId, 'celebrations');
  const birthdayCardBackground = studioBirthdayResource(guildId, 'card-background');
  const birthdayCardTestSend = studioBirthdayResource(guildId, 'card-test-send');
  options.push(
    {
      id: permissionOptionId('studio.settings.read', birthdayRegistrations),
      category: 'Birthday',
      label: 'メンバー誕生日 · 閲覧',
      description: '登録済みの誕生日・任意の生年を閲覧',
      action: 'studio.settings.read',
      resource: birthdayRegistrations,
    },
    {
      id: permissionOptionId('studio.settings.write', birthdayRegistrations),
      category: 'Birthday',
      label: 'メンバー誕生日 · 編集',
      description: 'メンバーの誕生日・任意の生年を登録・更新・解除',
      action: 'studio.settings.write',
      resource: birthdayRegistrations,
    },
    {
      id: permissionOptionId('studio.settings.read', birthdayCelebrations),
      category: 'Birthday',
      label: '祝い実績 · 閲覧',
      description: 'お祝い回数・最新年齢・サーバー参加後何回目の誕生日かを閲覧',
      action: 'studio.settings.read',
      resource: birthdayCelebrations,
    },
    {
      id: permissionOptionId('studio.settings.read', birthdayCardBackground),
      category: 'Birthday',
      label: 'Cardカスタム背景 · 閲覧',
      description: 'Guild専用Birthday Card背景のプレビューとメタデータを閲覧',
      action: 'studio.settings.read',
      resource: birthdayCardBackground,
    },
    {
      id: permissionOptionId('studio.settings.write', birthdayCardBackground),
      category: 'Birthday',
      label: 'Cardカスタム背景 · 編集',
      description: 'Guild専用Birthday Card背景をアップロード・差し替え・削除',
      action: 'studio.settings.write',
      resource: birthdayCardBackground,
    },
    {
      id: permissionOptionId('studio.operation.execute', birthdayCardTestSend),
      category: 'Birthday',
      label: 'Cardテスト送信',
      description: '現在のBirthday Cardプレビューを指定したDiscord Channelへテスト送信',
      action: 'studio.operation.execute',
      resource: birthdayCardTestSend,
    },
  );

  const anniversaryResource = studioBotProfileSettingResource(guildId, 'anniversary');
  options.push(
    {
      id: permissionOptionId('studio.settings.read', anniversaryResource),
      category: 'Bot Profile',
      label: 'サーバー周年日 · 閲覧',
      description: 'Bot自身の誕生日として扱うサーバー周年日を閲覧',
      action: 'studio.settings.read',
      resource: anniversaryResource,
    },
    {
      id: permissionOptionId('studio.settings.write', anniversaryResource),
      category: 'Bot Profile',
      label: 'サーバー周年日 · 編集',
      description: 'Bot自身の誕生日として扱うサーバー周年日を設定・解除',
      action: 'studio.settings.write',
      resource: anniversaryResource,
    },
  );

  for (const plugin of plugins) {
    const category = `Plugin / ${plugin.name}`;
    const enabledResource = pluginEnabledControlResource(guildId, plugin.id);
    options.push({
      id: permissionOptionId('studio.operation.execute', enabledResource),
      category,
      label: 'Plugin 有効 / 無効',
      description: `${plugin.name} の有効化・無効化を変更`,
      action: 'studio.operation.execute',
      resource: enabledResource,
    });

    for (const field of topLevelConfigFields(plugin.configSchema)) {
      const resource = pluginConfigFieldResource(guildId, plugin.id, field.key);
      options.push(
        {
          id: permissionOptionId('studio.settings.read', resource),
          category,
          label: `${field.label} · 閲覧`,
          description: field.description || `${field.label} の設定値を閲覧`,
          action: 'studio.settings.read',
          resource,
        },
        {
          id: permissionOptionId('studio.settings.write', resource),
          category,
          label: `${field.label} · 編集`,
          description: field.description || `${field.label} の設定値を変更`,
          action: 'studio.settings.write',
          resource,
        },
      );
    }
  }

  return options;
}

export function topLevelConfigFields(
  schema: Record<string, unknown>,
): Array<{ key: string; label: string; description: string }> {
  const properties = schema['properties'];
  if (!isRecord(properties)) return [];
  return Object.entries(properties).map(([key, value]) => {
    const property = isRecord(value) ? value : {};
    return {
      key,
      label: text(property['title']) || humanizeKey(key),
      description: text(property['description']),
    };
  });
}

function isPageViewActionPattern(action: string): boolean {
  return (
    action === '*' ||
    action === 'studio.*' ||
    action === 'studio.page.*' ||
    action === 'studio.page.view'
  );
}

function permissionOptionId(action: StudioPolicyAction, resource: string): string {
  return `${action}:${resource}`;
}

function accessPageLabel(page: 'overview' | 'users' | 'groups' | 'roles' | 'policies'): string {
  switch (page) {
    case 'overview':
      return 'Resources';
    case 'users':
      return 'Users';
    case 'groups':
      return 'Groups';
    case 'roles':
      return 'Roles';
    case 'policies':
      return 'Policies';
  }
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .replace(/^./u, (character) => character.toUpperCase());
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
