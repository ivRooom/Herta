import type { CommandOption, PluginManifest } from '@herta/shared';

const contentOptions: CommandOption[] = [
  {
    name: 'content',
    description: '通常本文。Discord Markdownを使用できます',
    type: 'string',
    required: false,
  },
  {
    name: 'format',
    description: '投稿形式',
    type: 'string',
    required: false,
    choices: [
      { name: '通常メッセージ', value: 'text' },
      { name: 'Embed', value: 'embed' },
    ],
  },
  { name: 'embed_title', description: 'Embedタイトル', type: 'string', required: false },
  { name: 'embed_description', description: 'Embed本文', type: 'string', required: false },
  { name: 'color', description: 'Embed色（例: #5865F2）', type: 'string', required: false },
  { name: 'image_url', description: 'Embed画像のHTTPS URL', type: 'string', required: false },
  {
    name: 'thumbnail_url',
    description: 'EmbedサムネイルのHTTPS URL',
    type: 'string',
    required: false,
  },
  { name: 'footer', description: 'Embedフッター', type: 'string', required: false },
  {
    name: 'image',
    description: '即時投稿へ添付する画像ファイル',
    type: 'attachment',
    required: false,
  },
];

const targetOption: CommandOption = {
  name: 'channel',
  description: '投稿先。省略時は設定済みのお知らせチャンネル',
  type: 'channel',
  required: false,
};

const forumTitleOption: CommandOption = {
  name: 'forum_title',
  description: 'Forumへ投稿する場合のスレッドタイトル',
  type: 'string',
  required: false,
};

export const dailyContentManifest: PluginManifest = {
  id: 'daily-content',
  name: 'Announcement / Message Studio',
  version: '2.0.0',
  description:
    'お知らせ・予約/定期投稿・Forum投稿・Bot発言・メッセージ返信を通常文/Embedで作成できます',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'daily-content.manage',
      name: 'Message Studio 管理',
      description: 'お知らせ、予約配信、Bot発言、返信、配信履歴を管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      defaultAnnouncementChannelId: {
        type: ['string', 'null'],
        title: '既定のお知らせチャンネル',
        description: '`/announce` でchannelを省略した場合の投稿先です',
        default: null,
        'x-herta-ui': {
          widget: 'discord-channel',
          channelTypes: ['GuildText', 'GuildAnnouncement', 'GuildForum'],
        },
      },
      defaultTimezone: {
        type: 'string',
        title: '既定Timezone',
        description: '予約・定期投稿の基準となるIANA timezoneです',
        default: 'Asia/Tokyo',
        minLength: 1,
        maxLength: 100,
      },
      maxSchedules: {
        type: 'integer',
        title: '最大予約数',
        minimum: 1,
        maximum: 500,
        default: 100,
      },
      maxContentLength: {
        type: 'integer',
        title: '通常本文の最大文字数',
        minimum: 1,
        maximum: 2000,
        default: 2000,
      },
      allowUserMentions: {
        type: 'boolean',
        title: 'ユーザーメンションを許可',
        description: '@everyone、@here、Role mentionは常に拒否します',
        default: false,
      },
      allowAnnouncementCrosspost: {
        type: 'boolean',
        title: 'Announcement Crosspostを許可',
        description: '有効時のみAnnouncement Channelで公開(Crosspost)を利用できます',
        default: false,
      },
      defaultMentionRepliedUser: {
        type: 'boolean',
        title: '返信先ユーザーを既定でメンション',
        default: true,
      },
      staleAfterMinutes: {
        type: 'integer',
        title: 'Stale判定時間（分）',
        minimum: 2,
        maximum: 1440,
        default: 10,
      },
      maxAttempts: {
        type: 'integer',
        title: '最大配信試行回数',
        minimum: 1,
        maximum: 10,
        default: 5,
      },
    },
    required: [
      'defaultTimezone',
      'maxSchedules',
      'maxContentLength',
      'allowUserMentions',
      'allowAnnouncementCrosspost',
      'defaultMentionRepliedUser',
      'staleAfterMinutes',
      'maxAttempts',
    ],
    'x-herta-ui': {
      sections: [
        {
          title: '投稿先',
          fields: ['defaultAnnouncementChannelId', 'defaultTimezone'],
        },
        {
          title: '投稿権限',
          fields: ['allowUserMentions', 'allowAnnouncementCrosspost', 'defaultMentionRepliedUser'],
        },
        {
          title: '配信制御',
          fields: ['maxSchedules', 'maxContentLength', 'staleAfterMinutes', 'maxAttempts'],
        },
      ],
      help: [
        'StudioのMessage ComposerではDiscord Markdown、Embed、画像URL、Forum投稿を編集できます。',
        '即時Slash Commandでは画像ファイル添付にも対応します。予約画像はHTTPS URLを利用します。',
        '@everyone / @here / Role mentionは誤爆防止のため使用できません。',
      ],
    },
  },
  events: [],
  commands: [
    {
      name: 'daily',
      description: '保存済みMessage Studio投稿を管理します',
      subcommands: [
        {
          name: 'preview',
          description: '保存済み投稿を本人だけにプレビューします',
          options: [
            {
              name: 'schedule_id',
              description: 'スケジュールID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'publish',
          description: '保存済み投稿を手動配信キューへ追加します',
          options: [
            {
              name: 'schedule_id',
              description: 'スケジュールID',
              type: 'string',
              required: true,
            },
          ],
        },
      ],
    },
    {
      name: 'announce',
      description: 'お知らせを即時・予約・定期投稿します',
      subcommands: [
        {
          name: 'send',
          description: 'お知らせを今すぐ投稿します',
          options: [
            targetOption,
            forumTitleOption,
            ...contentOptions,
            {
              name: 'crosspost',
              description: 'Announcement Channelで公開(Crosspost)する',
              type: 'boolean',
              required: false,
            },
          ],
        },
        {
          name: 'schedule',
          description: 'お知らせを1回予約します',
          options: [
            {
              name: 'at',
              description: '予約日時 YYYY-MM-DD HH:mm',
              type: 'string',
              required: true,
            },
            targetOption,
            forumTitleOption,
            ...contentOptions.filter((option) => option.name !== 'image'),
            {
              name: 'crosspost',
              description: 'Announcement Channelで公開(Crosspost)する',
              type: 'boolean',
              required: false,
            },
          ],
        },
        {
          name: 'recurring',
          description: '毎日または毎週のお知らせを登録します',
          options: [
            {
              name: 'cadence',
              description: '配信周期',
              type: 'string',
              required: true,
              choices: [
                { name: '毎日', value: 'daily' },
                { name: '毎週', value: 'weekly' },
              ],
            },
            {
              name: 'time',
              description: '配信時刻 HH:mm',
              type: 'string',
              required: true,
            },
            {
              name: 'weekdays',
              description: '週次のみ。月,水,金 または 1,3,5',
              type: 'string',
              required: false,
            },
            targetOption,
            forumTitleOption,
            ...contentOptions.filter((option) => option.name !== 'image'),
            {
              name: 'crosspost',
              description: 'Announcement Channelで公開(Crosspost)する',
              type: 'boolean',
              required: false,
            },
          ],
        },
        { name: 'list', description: '登録中のお知らせ予約を一覧表示します' },
        {
          name: 'cancel',
          description: '予約・定期投稿を停止します',
          options: [{ name: 'id', description: 'スケジュールID', type: 'string', required: true }],
        },
      ],
    },
    {
      name: 'say',
      description: 'Herta Botとして任意の場所へ発言・返信します',
      subcommands: [
        {
          name: 'send',
          description: 'チャンネル・Forum・ThreadへBotとして発言します',
          options: [{ ...targetOption, required: true }, forumTitleOption, ...contentOptions],
        },
        {
          name: 'reply',
          description: '指定したDiscordメッセージへBotとして返信します',
          options: [
            {
              name: 'message_url',
              description: '返信先DiscordメッセージURL',
              type: 'string',
              required: true,
            },
            ...contentOptions,
            {
              name: 'mention_user',
              description: '返信先ユーザーをメンションする',
              type: 'boolean',
              required: false,
            },
          ],
        },
      ],
    },
  ],
};
