import type { PluginManifest } from '@herta/shared';

const choices = (values: string[]) => values.map((value) => ({ name: value, value }));
export const fortuneManifest: PluginManifest = {
  id: 'fortune',
  name: '今日の運勢',
  version: '1.0.0',
  description:
    '任意プロフィールから、今日の運勢・ラッキーカラー・アイテム・行動をHertaの画像カードで楽しめます',
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
          description: '任意の占い情報を登録・確認（本人のみ、変更項目だけ指定）',
          options: [
            {
              name: 'birthday',
              description: '誕生日 YYYY-MM-DD / MM-DD（年齢・星座・干支は自動計算）',
              type: 'string',
            },
            {
              name: 'blood-type',
              description: '血液型（任意）',
              type: 'string',
              choices: choices(['A', 'B', 'O', 'AB']),
            },
            { name: 'mbti', description: 'MBTI（例 INFP-T / 任意・自己申告）', type: 'string' },
            {
              name: 'zodiac',
              description: '星座（誕生日を登録しない場合に指定）',
              type: 'string',
              choices: choices([
                '牡羊座',
                '牡牛座',
                '双子座',
                '蟹座',
                '獅子座',
                '乙女座',
                '天秤座',
                '蠍座',
                '射手座',
                '山羊座',
                '水瓶座',
                '魚座',
              ]),
            },
            {
              name: 'age-group',
              description: '年代（生年を登録しない場合に指定）',
              type: 'string',
              choices: choices(['10代以下', '20代', '30代', '40代', '50代', '60代以上']),
            },
            {
              name: 'eto',
              description: '干支（生年を登録しない場合に指定・日本の暦年方式）',
              type: 'string',
              choices: choices([
                '子',
                '丑',
                '寅',
                '卯',
                '辰',
                '巳',
                '午',
                '未',
                '申',
                '酉',
                '戌',
                '亥',
              ]),
            },
          ],
        },
        {
          name: 'forget',
          description: 'このサーバーの自分の占いプロフィールを削除する（結果は保存しません）',
        },
      ],
    },
  ],
};
