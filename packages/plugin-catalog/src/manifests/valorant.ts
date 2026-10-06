import type { PluginManifest } from '@herta/shared';

/** HenrikDev APIが受け付けるregion値。platform(pc/console)は常にpc固定とする(v1ではコンソール非対応)。 */
export const VALORANT_REGIONS = ['eu', 'na', 'ap', 'kr', 'latam', 'br'] as const;
export type ValorantRegion = (typeof VALORANT_REGIONS)[number];

const VALORANT_REGION_CHOICES = [
  { name: 'Europe (eu)', value: 'eu' },
  { name: 'North America (na)', value: 'na' },
  { name: 'Asia Pacific (ap)', value: 'ap' },
  { name: 'Korea (kr)', value: 'kr' },
  { name: 'Latin America (latam)', value: 'latam' },
  { name: 'Brazil (br)', value: 'br' },
];

export const valorantManifest: PluginManifest = {
  id: 'valorant',
  name: 'Valorant',
  version: '1.0.0',
  description:
    'Riot ID(Name#Tag)をDiscordアカウントへ連携し、現在のランク・RRなどVALORANTの戦績を確認できるPluginです（HenrikDev APIを利用）',
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
        title: 'Valorant戦績確認を有効化する',
        default: true,
        'x-herta-ui': {
          section: '基本設定',
          help: 'HenrikDev APIのAPI Key(環境変数)が未設定の場合、有効化していても戦績確認は利用できません。',
        },
      },
    },
    required: ['enabled'],
  },
  events: [],
  commands: [
    {
      name: 'valorant',
      description: 'VALORANTの戦績確認・Riot ID連携を行います',
      subcommands: [
        {
          name: 'link',
          description: 'あなたのDiscordアカウントへRiot IDを連携します',
          options: [
            {
              name: 'riot_id',
              description: 'Riot ID。Name#Tagの形式で入力します（例: Player#JP1）',
              type: 'string',
              required: true,
            },
            {
              name: 'region',
              description: 'プレイ地域',
              type: 'string',
              required: true,
              choices: VALORANT_REGION_CHOICES,
            },
          ],
        },
        {
          name: 'unlink',
          description: '連携済みのRiot IDを解除します',
        },
        {
          name: 'myid',
          description: '連携済みのRiot IDを確認します',
        },
        {
          name: 'stats',
          description: 'VALORANTの現在のランク・RRを表示します',
          options: [
            {
              name: 'user',
              description: '確認するDiscordユーザー（省略時は自分）',
              type: 'user',
            },
            {
              name: 'riot_id',
              description: '未連携のRiot IDを直接指定する場合（Name#Tag形式）',
              type: 'string',
            },
            {
              name: 'region',
              description: 'riot_id指定時は必須のプレイ地域',
              type: 'string',
              choices: VALORANT_REGION_CHOICES,
            },
          ],
        },
      ],
    },
  ],
};
