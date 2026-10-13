import type { PluginManifest } from '@herta/shared';

/**
 * AI FoundationのGuild opt-inとDiscord mention surfaceを表すcatalog manifest。
 * model / provider / quota / Secretはserver-side設定だけで解決し、Plugin configへ保存しない。
 * 会話・code/file artifact(attachment)・code execution・image generation・JMA天気groundingを
 * mention/reply trigger経由で提供する。`/ai ask`はmention無しで同じ経路を呼び出す入り口。
 */
export const aiManifest: PluginManifest = {
  id: 'ai',
  name: 'Herta AI',
  version: '1.1.0',
  description: 'Herta AIの会話・コード/画像生成・コード実行・成果物生成機能をGuild単位で管理します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'ai.use',
      name: 'Herta AI 利用',
      description: 'Guildで明示的に有効化されたHerta AI機能を利用します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'GuildでHerta AIを利用する',
        default: false,
        'x-herta-ui': {
          section: 'AI opt-in',
          help: 'Plugin自体の有効化とは別の明示opt-inです。Global AIが無効な場合はONでも外部AI providerを呼びません。',
        },
      },
      triggerRoleId: {
        type: ['string', 'null'],
        title: 'AIを呼び出すRole',
        pattern: '^\\d+$',
        default: null,
        'x-herta-ui': {
          section: '呼び出し設定',
          widget: 'discord-role',
          mentionableOnly: true,
          placeholder: 'AI呼び出しに使うRoleを選択（任意）',
          help: '設定した単一Roleへのreal mentionだけをHerta本人へのmentionと同じAI triggerとして扱います。Roleだけで呼び出すにはDiscord Developer PortalとBot runtimeのMessage Content Intentが有効である必要があります。未設定時はRole mentionで反応しません。',
        },
      },
      imageGenerationEnabled: {
        type: 'boolean',
        title: '画像生成を許可する',
        default: true,
        'x-herta-ui': {
          section: '機能別の有効/無効',
          help: 'OFFにすると画像生成依頼は拒否され、コスト発生を防げます（server側でAPI Keyが未設定の場合は既にOFF相当です）。',
        },
      },
      codeExecutionEnabled: {
        type: 'boolean',
        title: 'コード実行を許可する',
        default: true,
        'x-herta-ui': {
          section: '機能別の有効/無効',
          help: 'OFFにするとコード実行依頼は拒否されます（server側でAPI Keyが未設定の場合は既にOFF相当です）。',
        },
      },
      weatherGroundingEnabled: {
        type: 'boolean',
        title: '天気予報の自動groundingを許可する',
        default: true,
        'x-herta-ui': {
          section: '機能別の有効/無効',
          help: 'OFFにすると天気に関する質問でもJMAデータの自動取得を行わず、通常の会話として応答します。',
        },
      },
      premiumModelRoleId: {
        type: ['string', 'null'],
        title: '高品質モデル(quality)を使えるRole',
        pattern: '^\\d+$',
        default: null,
        'x-herta-ui': {
          section: 'モデル選択',
          widget: 'discord-role',
          placeholder: '上位モデルの利用を許可するRoleを選択（任意）',
          help: '`/ai model`で品質重視(quality)プロファイルを選べるのは、このRoleを持つメンバーだけです。未設定の場合、qualityは誰も選択できません（balanced/economyのみ）。',
        },
      },
    },
    required: [
      'enabled',
      'imageGenerationEnabled',
      'codeExecutionEnabled',
      'weatherGroundingEnabled',
      'premiumModelRoleId',
    ],
  },
  events: ['messageCreate'],
  commands: [
    {
      name: 'akinator',
      description:
        '思い浮かべた人物・キャラクターをAIがYes/No質問で当てるキャラ当てゲームを開始します',
    },
    {
      name: 'ai',
      description: 'Herta AIへメンション無しで直接質問・依頼を送ります',
      subcommands: [
        {
          name: 'ask',
          description: 'Herta AIに質問・依頼を送ります（メンションと同じ機能が使えます）',
          options: [
            {
              name: 'prompt',
              description: '質問・依頼内容',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'model',
          description: 'あなた専用のAIモデルを選択・確認・解除します',
          options: [
            {
              name: 'action',
              description: '操作',
              type: 'string',
              required: true,
              choices: [
                { name: '設定する', value: 'set' },
                { name: '確認する', value: 'show' },
                { name: '解除する（Guild既定に戻す）', value: 'clear' },
              ],
            },
            {
              name: 'provider',
              description: 'AIプロバイダ（action:setのとき必須）',
              type: 'string',
              choices: [
                { name: 'OpenAI', value: 'openai' },
                { name: 'Anthropic (Claude)', value: 'anthropic' },
                { name: 'Google (Gemini)', value: 'google' },
                { name: 'Moonshot (Kimi)', value: 'moonshot' },
              ],
            },
            {
              name: 'profile',
              description: '品質レベル（action:setのとき必須）',
              type: 'string',
              choices: [
                { name: '高品質 (quality) — 専用Roleが必要', value: 'quality' },
                { name: 'バランス (balanced)', value: 'balanced' },
                { name: '経済的 (economy)', value: 'economy' },
              ],
            },
          ],
        },
        {
          name: 'usage',
          description: 'AIの利用状況・推定コストを確認します（管理者のみ）',
          options: [
            {
              name: 'days',
              description: '集計期間（日数、既定7、最大90）',
              type: 'integer',
              minValue: 1,
              maxValue: 90,
            },
          ],
        },
      ],
    },
  ],
};
