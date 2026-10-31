import type { PluginManifest } from '@herta/shared';

/** HenrikDev APIが受け付けるregion値。platform(pc/console)は常にpc固定とする(v1ではコンソール非対応)。 */
export const VALORANT_REGIONS = ['eu', 'na', 'ap', 'kr', 'latam', 'br'] as const;
export type ValorantRegion = (typeof VALORANT_REGIONS)[number];

/**
 * Riot Games公式Agent一覧（2026-10-29 / Patch 13.09、Hushまで）。
 * 選択候補の正本。新Agent追加時はこのリストを更新する。
 */
export const VALORANT_AGENTS = [
  'Astra',
  'Breach',
  'Brimstone',
  'Chamber',
  'Clove',
  'Cypher',
  'Deadlock',
  'Fade',
  'Gekko',
  'Harbor',
  'Hush',
  'Iso',
  'Jett',
  'KAY/O',
  'Killjoy',
  'Miks',
  'Neon',
  'Omen',
  'Phoenix',
  'Raze',
  'Reyna',
  'Sage',
  'Skye',
  'Sova',
  'Tejo',
  'Veto',
  'Viper',
  'Vyse',
  'Waylay',
  'Yoru',
] as const;
export type ValorantAgent = (typeof VALORANT_AGENTS)[number];

// Names only, verified against Riot's Japanese agents page. No remote API or artwork dependency.
const JAPANESE_AGENT_NAMES = [
  'アストラ',
  'ブリーチ',
  'ブリムストーン',
  'チェンバー',
  'クローヴ',
  'サイファー',
  'デッドロック',
  'フェイド',
  'ゲッコー',
  'ハーバー',
  'ハッシュ',
  'アイソ',
  'ジェット',
  'KAY/O',
  'キルジョイ',
  'ミクス',
  'ネオン',
  'オーメン',
  'フェニックス',
  'レイズ',
  'レイナ',
  'セージ',
  'スカイ',
  'ソーヴァ',
  'テホ',
  'ヴィトー',
  'ヴァイパー',
  'ヴァイス',
  'ウェイレイ',
  'ヨル',
];

/** Missing legacy selection means default-all; explicit empty/invalid lists fail closed. */
export function legacyValorantAgents(value: unknown): string[] {
  if (value === undefined) return [...VALORANT_AGENTS];
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (agent): agent is ValorantAgent =>
          typeof agent === 'string' && (VALORANT_AGENTS as readonly string[]).includes(agent),
      ),
    ),
  ];
}

export function defaultValorantAgents(legacySelection?: unknown) {
  const selected = new Set(legacyValorantAgents(legacySelection));
  return VALORANT_AGENTS.map((agentName, index) => ({
    agentId: agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    agentName,
    displayName: JAPANESE_AGENT_NAMES[index]!,
    enabled: selected.has(agentName),
  }));
}

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
  version: '1.3.0',
  description: 'Riot ID連携・戦績確認と、参加ボタン方式のエージェント抽選ができるPluginです',
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
      maxParticipants: {
        type: 'integer',
        title: '抽選の最大参加人数',
        minimum: 1,
        maximum: 5,
        default: 5,
      },
      sessionDurationMinutes: {
        type: 'integer',
        title: '参加募集の期限（分）',
        minimum: 5,
        maximum: 180,
        default: 30,
      },
      enabledAgents: {
        type: 'array',
        title: 'ランダム抽選対象エージェント',
        description:
          '初期登録前の抽選候補。エージェント管理画面で初期登録後はGuild別データを使用します。',
        uniqueItems: true,
        minItems: 0,
        maxItems: VALORANT_AGENTS.length,
        items: { type: 'string', enum: [...VALORANT_AGENTS] },
        default: [...VALORANT_AGENTS],
        'x-herta-ui': {
          section: 'エージェント',
          help: '初期登録前のみ使用する互換設定です。初期登録後の追加・編集・無効化・削除はエージェント管理画面で行います。',
        },
      },
    },
    required: ['enabled'],
  },
  events: [],
  commands: [
    {
      name: 'valorant',
      description: 'VALORANTの戦績確認・Riot ID連携・エージェント抽選',
      subcommands: [
        {
          name: 'random',
          description: '参加募集または@指定メンバーで抽選（結果から再抽選可能）',
          options: [
            {
              name: 'map',
              description: '指定するとマップ別の実戦向け構成候補から抽選',
              type: 'string',
              choices: [
                { name: 'アセント', value: 'Ascent' },
                { name: 'バインド', value: 'Bind' },
                { name: 'ヘイヴン', value: 'Haven' },
                { name: 'スプリット', value: 'Split' },
                { name: 'アイスボックス', value: 'Icebox' },
                { name: 'ブリーズ', value: 'Breeze' },
                { name: 'フラクチャー', value: 'Fracture' },
                { name: 'パール', value: 'Pearl' },
                { name: 'ロータス', value: 'Lotus' },
                { name: 'サンセット', value: 'Sunset' },
                { name: 'アビス', value: 'Abyss' },
                { name: 'カロード', value: 'Corrode' },
                { name: 'SUMMIT', value: 'Summit' },
              ],
            },
            ...Array.from({ length: 5 }, (_, index) => ({
              name: `member${index + 1}`,
              description:
                index === 0
                  ? '指定すると募集を省略して即時抽選（@メンバー・最大5人）'
                  : `抽選に追加する@メンバー（${index + 1}人目）`,
              type: 'user' as const,
            })),
          ],
        },
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
