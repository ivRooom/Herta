import type { PluginManifest } from '@herta/shared';

export const MBTI_TYPE_KEYS = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
] as const;

export function mbtiRoleConfigKey(type: string): string {
  return `mbtiRole${type}`;
}

const MBTI_ROLE_CONFIG_PROPERTIES: Record<string, unknown> = Object.fromEntries(
  MBTI_TYPE_KEYS.map((type) => [
    mbtiRoleConfigKey(type),
    {
      type: ['string', 'null'],
      title: `MBTI Role: ${type}`,
      default: null,
      'x-herta-ui': {
        section: 'MBTI Role',
        widget: 'discord-role',
        editableOnly: true,
        placeholder: `診断結果が${type}のメンバーへ付与するRoleを選択（任意）`,
        help: '未設定のタイプはRole付与をスキップします。全タイプ未設定ならMBTI Role機能は無効です。',
      },
    },
  ]),
);

export const mbtiManifest: PluginManifest = {
  id: 'mbti',
  name: 'MBTI',
  version: '1.0.0',
  description:
    '50問の5段階評価に答えてMBTI風の性格診断を行い、結果に応じてDiscord Roleを自動付与できるPluginです',
  author: { name: 'Herta' },
  category: 'fun',
  permissions: [
    {
      id: 'mbti.manage',
      name: 'MBTI 管理',
      description: 'MBTI診断のRole付与設定を管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'MBTI診断を有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ...MBTI_ROLE_CONFIG_PROPERTIES,
    },
    required: ['enabled'],
  },
  events: [],
  commands: [
    {
      name: 'mbti',
      description: '50問の5段階評価に答えてMBTI風の性格診断を行います',
    },
  ],
};
