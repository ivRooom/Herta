import type { PluginManifest } from '@herta/shared';

export const eventRsvpManifest: PluginManifest = {
  id: 'event-rsvp',
  name: 'Event / RSVP',
  version: '1.0.0',
  description: 'イベント告知・参加表明・定員・Waiting List・開催前Reminderを提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'event-rsvp.use',
      name: 'Event / RSVP 利用',
      description: 'イベントの作成・確認・キャンセルとRSVP参加表明を行います',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Event / RSVPを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ephemeralResponses: {
        type: 'boolean',
        title: '管理コマンド結果を本人だけに表示する',
        default: true,
        'x-herta-ui': {
          section: '基本設定',
          help: 'イベント本体はチャンネルへ公開し、作成・確認メッセージだけを本人向けにします。',
        },
      },
      eventChannelId: {
        type: ['string', 'null'],
        title: 'イベント投稿先チャンネル',
        default: null,
        'x-herta-ui': {
          section: '投稿先',
          widget: 'discord-channel',
          channelTypes: ['GuildText', 'GuildAnnouncement'],
          placeholder: 'イベントを公開するチャンネルを選択',
          help: '未設定の場合は /event create を実行したチャンネルへ投稿します。',
        },
      },
      timezone: {
        type: 'string',
        title: '日時入力のTimezone',
        minLength: 1,
        maxLength: 64,
        default: 'Asia/Tokyo',
        'x-herta-ui': {
          section: '日時設定',
          help: 'IANA Time Zone形式で指定します。例: Asia/Tokyo。/event create の start をこのTimezoneとして解釈します。',
        },
      },
      defaultCapacity: {
        type: 'integer',
        title: '既定の定員',
        minimum: 0,
        maximum: 500,
        default: 0,
        'x-herta-ui': {
          section: '参加設定',
          help: '0は定員なしです。コマンドでcapacityを省略した場合に使います。',
        },
      },
      maxCapacity: {
        type: 'integer',
        title: '設定できる定員の上限',
        minimum: 1,
        maximum: 500,
        default: 100,
        'x-herta-ui': { section: '参加設定' },
      },
      allowMaybe: {
        type: 'boolean',
        title: '「未定」RSVPを許可する',
        default: true,
        'x-herta-ui': { section: '参加設定' },
      },
      allowWaitlist: {
        type: 'boolean',
        title: '満員時にWaiting Listへ登録する',
        default: true,
        'x-herta-ui': {
          section: '参加設定',
          help: '参加者が辞退した場合、Waiting Listの先頭を自動で参加へ繰り上げます。',
        },
      },
      registrationCloseMinutesBefore: {
        type: 'integer',
        title: '開催何分前にRSVPを締め切るか',
        minimum: 0,
        maximum: 10080,
        default: 0,
        'x-herta-ui': {
          section: '日時設定',
          help: '0の場合は開催時刻まで参加表明できます。',
        },
      },
      reminderEnabled: {
        type: 'boolean',
        title: '開催前Reminderを送る',
        default: true,
        'x-herta-ui': { section: 'Reminder' },
      },
      reminderMinutesBefore: {
        type: 'integer',
        title: '開催何分前にReminderするか',
        minimum: 0,
        maximum: 10080,
        default: 60,
        'x-herta-ui': {
          section: 'Reminder',
          help: '0にするとReminderを送信しません。',
        },
      },
      mentionParticipantsOnReminder: {
        type: 'boolean',
        title: 'Reminderで参加予定者をメンションする',
        default: true,
        'x-herta-ui': {
          section: 'Reminder',
          help: '最大50名までメンションし、それ以上は人数だけ表示します。',
        },
      },
      maxActivePerUser: {
        type: 'integer',
        title: 'ユーザーごとの同時開催イベント上限',
        minimum: 1,
        maximum: 20,
        default: 5,
        'x-herta-ui': {
          section: '制限',
          help: '未開催のイベントを大量作成してチャンネルを占有することを防ぎます。',
        },
      },
    },
    required: [
      'enabled',
      'ephemeralResponses',
      'eventChannelId',
      'timezone',
      'defaultCapacity',
      'maxCapacity',
      'allowMaybe',
      'allowWaitlist',
      'registrationCloseMinutesBefore',
      'reminderEnabled',
      'reminderMinutesBefore',
      'mentionParticipantsOnReminder',
      'maxActivePerUser',
    ],
  },
  events: ['interactionCreate'],
  commands: [
    {
      name: 'event',
      description: 'イベントを作成・確認し、RSVPを管理します',
      subcommands: [
        {
          name: 'create',
          description: '新しいイベントを作成します',
          options: [
            {
              name: 'title',
              description: 'イベント名（1〜200文字）',
              type: 'string',
              required: true,
            },
            {
              name: 'start',
              description: '開催日時。例: 2026-08-15 20:00',
              type: 'string',
              required: true,
            },
            {
              name: 'description',
              description: '説明（1000文字以内）',
              type: 'string',
            },
            {
              name: 'location',
              description: '場所・VC・URL等（200文字以内）',
              type: 'string',
            },
            {
              name: 'capacity',
              description: '定員。省略時はStudio設定、0設定時は無制限',
              type: 'integer',
              minValue: 1,
              maxValue: 500,
            },
          ],
        },
        { name: 'list', description: '今後開催されるイベントを一覧表示します' },
        {
          name: 'info',
          description: 'イベントの詳細とRSVP状況を表示します',
          options: [
            {
              name: 'id',
              description: 'Event ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'cancel',
          description: 'イベントをキャンセルします',
          options: [
            {
              name: 'id',
              description: 'Event ID',
              type: 'string',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};
