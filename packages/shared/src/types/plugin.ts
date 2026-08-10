/** Plugin のカテゴリ */
export type PluginCategory = 'core' | 'moderation' | 'fun' | 'game' | 'utility' | 'analytics';

/** Plugin の権限定義 */
export interface PluginPermission {
  id: string;
  name: string;
  description: string;
}

/** Plugin の依存関係 */
export interface PluginDependency {
  pluginId: string;
  optional?: boolean;
}

/** Slash Command 定義 */
export interface CommandDefinition {
  name: string;
  description: string;
  options?: CommandOption[];
  subcommands?: CommandSubcommand[];
}

/** Slash Command サブコマンド定義 */
export interface CommandSubcommand {
  name: string;
  description: string;
  options?: CommandOption[];
}

/** Slash Command オプション */
export interface CommandOption {
  name: string;
  description: string;
  type: 'string' | 'integer' | 'boolean' | 'user' | 'channel' | 'role';
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
  minValue?: number;
  maxValue?: number;
}

/** Plugin マニフェスト */
export interface PluginManifest {
  /** 一意識別子 (kebab-case) */
  id: string;
  /** 表示名 */
  name: string;
  /** セマンティックバージョン */
  version: string;
  /** 説明 */
  description: string;
  /** 作者情報 */
  author: {
    name: string;
    url?: string;
  };
  /** カテゴリ */
  category: PluginCategory;
  /** 要求する権限 */
  permissions: PluginPermission[];
  /** 依存する他の Plugin */
  dependencies: PluginDependency[];
  /** 設定の JSON Schema */
  configSchema: Record<string, unknown>;
  /** 購読する Discord イベント */
  events: string[];
  /** 登録する Slash Command */
  commands: CommandDefinition[];
  /** 最小 Herta バージョン */
  minHertaVersion?: string;
}
