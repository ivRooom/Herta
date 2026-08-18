import type { StudioPolicyAction } from './studio-access-policy.ts';
import {
  pluginConfigFieldResource,
  pluginEnabledControlResource,
} from './studio-plugin-permissions.ts';

export const STUDIO_PAGE_DEFINITIONS = [
  { id: 'overview', label: 'サーバー概要', description: '選択中サーバーの概要・Attention・状態を閲覧' },
  { id: 'message-studio', label: 'Botで発言', description: 'Message Studio、予約投稿、定期投稿を閲覧' },
  { id: 'commands', label: 'コマンド', description: 'Slash Command一覧・利用状況を閲覧' },
  { id: 'roles', label: 'Role Manager', description: 'Discord Role Lifecycle画面を閲覧' },
  { id: 'access', label: 'Access Control', description: 'Herta IAM / Access Control Centerを閲覧' },
  { id: 'plugins', label: 'プラグイン', description: 'Plugin一覧・Plugin設定画面を閲覧' },
  { id: 'leaderboard', label: 'Leaderboard', description: 'Guildランキングを閲覧' },
  { id: 'moderation', label: 'Moderation', description: 'Case・自動検知・自動対応の管理画面を閲覧' },
  { id: 'audit-logs', label: '監査ログ', description: 'Guildの監査ログを閲覧' },
  { id: 'bot-profile', label: 'Botプロフィール', description: 'GuildごとのBotプロフィール設定を閲覧' },
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
  policies: readonly { discordRoleId: string }[];
  managedPolicies: readonly unknown[];
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

export function hasApplicableStudioPolicy(access: ApplicableStudioPolicyContext): boolean {
  if (access.managedPolicies.length > 0) return true;
  const activeRoleIds = new Set(access.roleIds);
  return access.policies.some((policy) => activeRoleIds.has(policy.discordRoleId));
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
