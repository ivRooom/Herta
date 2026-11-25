import type { PluginManifest } from '@herta/shared';

export const decoGachaManifest: PluginManifest = {
  id: 'deco-gacha',
  name: 'デコガチャ',
  version: '1.0.0',
  description:
    'ヘルタおみくじ（1日1回・Webと共通）と、装備デコを反映したプロフィールカードを表示します',
  author: { name: 'Herta' },
  category: 'fun',
  permissions: [],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'デコガチャ連携を有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
    },
    required: ['enabled'],
  },
  events: [],
  commands: [
    {
      name: 'omikuji',
      description: 'ヘルタおみくじを引く（1日1回・Web版と共通、判定はWeb側）',
    },
    {
      name: 'deco-card',
      description:
        '装備デコ（カバー/台紙/フレーム/称号）と今日の運勢を反映したプロフィールカードを表示',
      options: [
        {
          name: 'user',
          description: 'カードを表示するメンバー（未指定なら自分）',
          type: 'user',
        },
        {
          name: 'public',
          description: 'カードをチャンネルへ公開する（既定は本人のみ）',
          type: 'boolean',
        },
      ],
    },
  ],
};
