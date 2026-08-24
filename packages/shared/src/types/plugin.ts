import {
  DEFAULT_PLUGIN_RUNTIME_CONSUMER,
  isPluginRuntimeConsumer,
  type PluginRuntimeConsumer,
} from '../plugin-runtime-events.js';

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
  type: 'string' | 'integer' | 'boolean' | 'user' | 'channel' | 'role' | 'attachment';
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
  /** Runtime 設定の反映 ACK を期待する consumer。未指定時は Bot */
  expectedRuntimeConsumers?: PluginRuntimeConsumer[];
  /** 最小 Herta バージョン */
  minHertaVersion?: string;
}

/**
 * 既存PluginはBot Runtimeのみを前提としているため、expected consumer未指定をBotへ解決する。
 * 静的Manifestが不正値や空配列を含んでもquorumを空にせず、安全側のBot互換へfallbackする。
 */
export function resolveExpectedRuntimeConsumers(
  manifest: Pick<PluginManifest, 'expectedRuntimeConsumers'>,
): PluginRuntimeConsumer[] {
  const configured = manifest.expectedRuntimeConsumers?.filter(isPluginRuntimeConsumer) ?? [];
  if (configured.length === 0) return [DEFAULT_PLUGIN_RUNTIME_CONSUMER];
  return [...new Set(configured)];
}
