import type { PluginManifest } from '@herta/shared';

export const fortuneManifest: PluginManifest = {
  id: 'fortune',
  name: '今日の運勢',
  version: '1.1.0',
  description:
    'ivrm-webのプロフィールから、今日の運勢・ラッキーカラー・アイテム・行動をHertaの画像カードで楽しめます',
  author: { name: 'Herta' },
  category: 'fun',
  permissions: [],
  dependencies: [],
  events: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { enabled: { type: 'boolean', title: '今日の運勢を有効にする', default: true } },
    required: ['enabled'],
  },
  commands: [
    {
      name: 'fortune',
      description: '今日の運勢を占います（エンタメ）',
      subcommands: [
        {
          name: 'today',
          description: '今日の運勢と画像カードを表示（既定は本人のみ）',
          options: [
            {
              name: 'public',
              description: 'カードと運勢をチャンネルへ公開する（誕生日などは非公開）',
              type: 'boolean',
            },
          ],
        },
        {
          name: 'profile',
          description: 'ivrm-webから取得した本人の占い情報を確認（変更はmember.ivrm.jp）',
        },
        {
          name: 'forget',
          description: 'Hertaに以前手入力した情報を削除（ivrm-webの情報は変更しません）',
        },
      ],
    },
  ],
};
