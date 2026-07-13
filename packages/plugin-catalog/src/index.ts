import { PrismaClient } from '@herta/db';
import type { PluginManifest } from '@herta/shared';

const pluginManifests: PluginManifest[] = [
  {
    id: 'auto-response',
    name: 'Auto Response',
    version: '1.0.0',
    description: 'キーワード・正規表現に基づく自動応答',
    author: { name: 'Herta' },
    category: 'utility',
    permissions: [
      {
        id: 'auto-response.manage',
        name: 'Auto Response 管理',
        description: '自動応答ルールの追加・編集・削除',
      },
    ],
    dependencies: [],
    configSchema: {
      type: 'object',
      properties: {
        maxResponses: { type: 'number', default: 50 },
        cooldownMs: { type: 'number', default: 3000 },
      },
    },
    events: ['messageCreate'],
    commands: [{ name: 'autoresponse', description: '自動応答の管理' }],
  },
  {
    id: 'daily-content',
    name: 'Daily Content',
    version: '1.0.0',
    description: '毎日の定時メッセージ送信',
    author: { name: 'Herta' },
    category: 'utility',
    permissions: [
      {
        id: 'daily-content.manage',
        name: 'Daily Content 管理',
        description: '定時メッセージの設定',
      },
    ],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [{ name: 'daily', description: '定時メッセージの管理' }],
  },
  {
    id: 'lfg',
    name: 'LFG',
    version: '1.0.0',
    description: 'メンバー募集 (Looking For Group)',
    author: { name: 'Herta' },
    category: 'game',
    permissions: [{ id: 'lfg.manage', name: 'LFG 管理', description: 'LFG 設定の管理' }],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [{ name: 'lfg', description: 'メンバー募集' }],
  },
  {
    id: 'moderation',
    name: 'Moderation',
    version: '1.0.0',
    description: 'NGワードフィルター、スパム検知、招待リンク管理',
    author: { name: 'Herta' },
    category: 'moderation',
    permissions: [
      { id: 'moderation.manage', name: 'Moderation 管理', description: 'モデレーション設定の管理' },
    ],
    dependencies: [],
    configSchema: {},
    events: ['messageCreate', 'messageUpdate'],
    commands: [{ name: 'mod', description: 'モデレーション管理' }],
  },
  {
    id: 'quote',
    name: 'Quote',
    version: '1.0.0',
    description: '名言の登録・表示・管理',
    author: { name: 'Herta' },
    category: 'fun',
    permissions: [
      { id: 'quote.manage', name: 'Quote 管理', description: '名言の追加・編集・削除' },
    ],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [{ name: 'quote', description: '名言の管理' }],
  },
  {
    id: 'team-split',
    name: 'Team Split',
    version: '1.0.0',
    description: 'ランダムチーム分け',
    author: { name: 'Herta' },
    category: 'game',
    permissions: [
      { id: 'team-split.manage', name: 'Team Split 管理', description: 'チーム分け設定の管理' },
    ],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [{ name: 'team', description: 'チーム分け' }],
  },
];

const pluginManifestMap = new Map(pluginManifests.map((manifest) => [manifest.id, manifest]));

export function getPluginManifest(id: string): PluginManifest | undefined {
  return pluginManifestMap.get(id);
}

export function getAllPluginManifests(): PluginManifest[] {
  return [...pluginManifests];
}

export interface EnabledPlugin {
  manifest: PluginManifest;
  config: Record<string, unknown>;
  configVersion: number;
}

/**
 * Enabled guild plugins for the future Bot Plugin Loader.
 * The loader can use the returned manifest and config to initialize each
 * already-installed plugin without dynamically importing untrusted data.
 */
export async function getEnabledPlugins(
  prisma: PrismaClient,
  guildId: string,
): Promise<EnabledPlugin[]> {
  const rows = await prisma.guildPlugin.findMany({
    where: { guildId, enabled: true },
    include: { plugin: true },
  });

  return rows.flatMap((row) => {
    const manifest = getPluginManifest(row.pluginId);
    if (!manifest) return [];

    return [
      {
        manifest,
        config: isRecord(row.config) ? row.config : {},
        configVersion: row.configVersion,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
