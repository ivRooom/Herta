import type { PluginManifest } from '@herta/shared';

export const roleManagerManifest: PluginManifest = {
  id: 'role-manager',
  name: 'Role Manager',
  version: '1.0.0',
  description:
    'メンバーが許可されたRoleを自分で付け外しできるSelf Role機能を提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'role-manager.manage',
      name: 'Role Manager 管理',
      description: 'Self Roleグループと選択可能Roleの設定を管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Role Managerを有効化する',
        default: true,
      },
      ephemeralResponses: {
        type: 'boolean',
        title: 'コマンド結果を本人だけに表示する',
        default: true,
      },
      allowSelfRemoval: {
        type: 'boolean',
        title: 'メンバー自身によるRole解除を許可する',
        default: true,
      },
      groups: {
        type: 'array',
        title: 'Self Roleグループ',
        description:
          'Roleは複数グループへ重複登録せず、Herta Botより下位にある編集可能Roleだけを指定してください',
        maxItems: 25,
        default: [],
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: {
              type: 'boolean',
              title: 'グループを有効化する',
              default: true,
            },
            id: {
              type: 'string',
              title: 'グループID',
              description: '設定内で一意な識別子です',
              pattern: '^[a-z0-9][a-z0-9_-]{0,31}$',
              default: 'roles',
            },
            name: {
              type: 'string',
              title: '表示名',
              minLength: 1,
              maxLength: 80,
              default: 'Self Roles',
            },
            description: {
              type: ['string', 'null'],
              title: '説明',
              minLength: 1,
              maxLength: 200,
              default: null,
            },
            mode: {
              type: 'string',
              title: '選択方式',
              description:
                'singleは同じグループから1つだけ、multipleは最大選択数まで同時に保持できます',
              enum: ['single', 'multiple'],
              default: 'multiple',
            },
            maxSelections: {
              type: 'integer',
              title: '最大選択数',
              description: 'singleでは自動的に1として扱われます',
              minimum: 1,
              maximum: 25,
              default: 25,
            },
            roleIds: {
              type: 'array',
              title: '選択可能Role',
              description: 'この一覧に含まれるRoleだけをSelf Roleとして操作できます',
              uniqueItems: true,
              minItems: 1,
              maxItems: 25,
              default: [],
              items: { type: 'string', pattern: '^\\d+$' },
              'x-herta-ui': {
                widget: 'discord-role',
                multiple: true,
                editableOnly: true,
                placeholder: 'Self Roleとして許可するRoleを検索',
              },
            },
          },
          required: [
            'enabled',
            'id',
            'name',
            'description',
            'mode',
            'maxSelections',
            'roleIds',
          ],
        },
      },
    },
    required: ['enabled', 'ephemeralResponses', 'allowSelfRemoval', 'groups'],
  },
  events: [],
  commands: [
    {
      name: 'role',
      description: 'Self Roleを確認・変更します',
      subcommands: [
        {
          name: 'list',
          description: '選択可能なSelf Role一覧を表示します',
        },
        {
          name: 'add',
          description: 'Self Roleを追加します',
          options: [
            {
              name: 'role',
              description: '追加するRole',
              type: 'role',
              required: true,
            },
          ],
        },
        {
          name: 'remove',
          description: 'Self Roleを解除します',
          options: [
            {
              name: 'role',
              description: '解除するRole',
              type: 'role',
              required: true,
            },
          ],
        },
        {
          name: 'toggle',
          description: 'Self Roleの付与・解除を切り替えます',
          options: [
            {
              name: 'role',
              description: '切り替えるRole',
              type: 'role',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};
