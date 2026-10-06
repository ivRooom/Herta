import type { PluginManifest } from '@herta/shared';

export const activityLogManifest: PluginManifest = {
  id: 'activity-log',
  name: 'Activity Log',
  version: '1.0.0',
  description:
    'VC入退室・メッセージ作成/編集/削除・絵文字登録等のメンバー行動を記録します。モデレーション調査・統計分析の両方に使えます',
  author: { name: 'Herta' },
  category: 'moderation',
  permissions: [
    {
      id: 'activity-log.view',
      name: 'Activity Log 閲覧',
      description: '記録されたメンバー行動ログを確認します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Activity Logを有効化する',
        default: false,
        'x-herta-ui': {
          section: '基本設定',
          help: 'メッセージの編集前・削除時の本文をDBへ保存します(6ヶ月後に本文だけ自動削除)。有効化前に記録内容を確認してください。',
        },
      },
      trackVoice: {
        type: 'boolean',
        title: 'VC入室・退室を記録する',
        default: true,
        'x-herta-ui': { section: '記録対象' },
      },
      trackMessages: {
        type: 'boolean',
        title: 'メッセージ作成・編集・削除を記録する',
        default: true,
        'x-herta-ui': {
          section: '記録対象',
          help: '編集前・削除時の本文はHertaが直前にキャッシュしている場合のみ記録できます。',
        },
      },
      trackEmoji: {
        type: 'boolean',
        title: '絵文字の登録・変更・削除を記録する',
        default: true,
        'x-herta-ui': { section: '記録対象' },
      },
      excludedChannelIds: {
        type: 'array',
        title: '記録から除外するチャンネル',
        uniqueItems: true,
        maxItems: 50,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
        'x-herta-ui': {
          section: '除外設定',
          widget: 'discord-channel',
          multiple: true,
          placeholder: '記録しないチャンネルを選択',
        },
      },
      excludedRoleIds: {
        type: 'array',
        title: '記録から除外するRole',
        uniqueItems: true,
        maxItems: 50,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
        'x-herta-ui': {
          section: '除外設定',
          widget: 'discord-role',
          multiple: true,
          placeholder: '記録対象外にするRoleを選択(運営Bot等)',
        },
      },
    },
    required: [
      'enabled',
      'trackVoice',
      'trackMessages',
      'trackEmoji',
      'excludedChannelIds',
      'excludedRoleIds',
    ],
  },
  events: [],
  commands: [
    {
      name: 'activity-log',
      description: 'メンバーの行動ログを確認します（管理者のみ）',
      options: [
        { name: 'user', description: '確認するユーザー', type: 'user' },
        {
          name: 'event',
          description: '絞り込むイベント種別',
          type: 'string',
          choices: [
            { name: 'VC入室', value: 'voice_join' },
            { name: 'VC退室', value: 'voice_leave' },
            { name: 'メッセージ作成', value: 'message_create' },
            { name: 'メッセージ編集', value: 'message_update' },
            { name: 'メッセージ削除', value: 'message_delete' },
            { name: '絵文字登録', value: 'emoji_create' },
            { name: '絵文字変更', value: 'emoji_update' },
            { name: '絵文字削除', value: 'emoji_delete' },
          ],
        },
        {
          name: 'limit',
          description: '表示件数（1〜25、既定10）',
          type: 'integer',
          minValue: 1,
          maxValue: 25,
        },
      ],
    },
  ],
};
