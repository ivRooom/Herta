import { notFound } from 'next/navigation';

import { PluginConfigForm } from '@/components/plugin-config-form';

export const dynamic = 'force-dynamic';

const fieldKeys = [
  'systemContext',
  'responseTone',
  'language',
  'historySummary',
  'fallbackMessage',
  'allowedRoleId',
] as const;

export default function PluginConfigMobileE2EPage() {
  if (process.env.NODE_ENV === 'production' || process.env.HERTA_STUDIO_E2E !== '1') {
    notFound();
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-4 sm:p-8">
      <PluginConfigForm
        guildId="123456789012345678"
        pluginId="herta-ai-e2e"
        initialEnabled
        initialConfig={{
          systemContext: 'Hertaとして自然な会話を行う',
          responseTone: 'casual',
          language: 'ja',
          historySummary: '直近の会話を参照する',
          fallbackMessage: 'うまく答えられないときは正直に伝える',
          allowedRoleId: '',
        }}
        schema={{
          type: 'object',
          additionalProperties: false,
          properties: {
            systemContext: {
              type: 'string',
              title: 'System Context',
              description: '会話の基本方針を指定します。',
            },
            responseTone: {
              type: 'string',
              title: '応答トーン',
              description: '通常会話のトーンを指定します。',
            },
            language: {
              type: 'string',
              title: '優先言語',
              description: '通常応答で優先する言語を指定します。',
            },
            historySummary: {
              type: 'string',
              title: '会話履歴',
              description: '会話履歴の扱いを指定します。',
            },
            fallbackMessage: {
              type: 'string',
              title: 'Fallback Message',
              description: '応答できない場合の案内を指定します。',
            },
            allowedRoleId: {
              type: 'string',
              title: 'AIを呼び出すRole',
              description: 'AIを利用できるDiscord Roleを選択します。',
              'x-herta-ui': {
                widget: 'discord-role',
                placeholder: 'AI Roleを選択',
              },
            },
          },
        }}
        discordOptions={{
          guildId: '123456789012345678',
          guildName: 'E2E Guild',
          channels: [],
          roles: [
            {
              id: '111111111111111111',
              name: 'Herta AI Tester',
              color: '#8b5cf6',
              position: 2,
              managed: false,
              mentionable: true,
              editable: true,
            },
            {
              id: '222222222222222222',
              name: 'Herta AI Reviewer',
              color: '#3b82f6',
              position: 1,
              managed: false,
              mentionable: true,
              editable: true,
            },
          ],
          emojis: [],
          bot: {
            manageMessages: true,
            manageRoles: true,
            moderateMembers: true,
            kickMembers: false,
            banMembers: false,
            mentionEveryone: false,
            highestRolePosition: 10,
          },
          fetchedAt: '2026-09-05T00:00:00.000Z',
        }}
        configAccess={{
          canToggleEnabled: true,
          readableFieldKeys: [...fieldKeys],
          editableFieldKeys: [...fieldKeys],
          readableConfigPaths: [...fieldKeys],
          editableConfigPaths: [...fieldKeys],
          allConfigPathsReadable: true,
          allConfigPathsEditable: true,
        }}
      />
    </main>
  );
}
