import { createLfgComponentId } from './component-id.js';
import type { LfgPostRecord } from './service.js';

const ACTIVE_STATUSES = new Set(['open', 'full']);

export interface LfgDiscordMessagePayload {
  content?: string;
  embeds: Array<Record<string, unknown>>;
  components: Array<Record<string, unknown>>;
  allowed_mentions: { parse: string[] };
}

export function buildLfgDiscordMessage(
  post: LfgPostRecord,
  participantIds: string[],
  componentSecret: string,
): LfgDiscordMessagePayload {
  const active = ACTIVE_STATUSES.has(post.status);
  const participantText = participantIds.length
    ? participantIds
        .slice(0, 30)
        .map((id) => `<@${id}>`)
        .join(' ')
    : '参加者なし';
  return {
    embeds: [
      {
        title: post.title,
        description: post.description || '説明なし',
        fields: [
          { name: 'ゲーム・イベント', value: post.game, inline: true },
          {
            name: '参加人数',
            value: `${post.participantCount} / ${post.maxPlayers}`,
            inline: true,
          },
          { name: '状態', value: post.status, inline: true },
          {
            name: '開始予定',
            value: post.startTime ? discordTimestamp(post.startTime) : '未指定',
            inline: true,
          },
          { name: '募集期限', value: discordTimestamp(post.expiresAt), inline: true },
          { name: '参加者', value: participantText.slice(0, 1024) },
        ],
        footer: { text: `LFG ID: ${post.id} / v${post.version}` },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: post.status === 'full' ? '満員' : '参加',
            custom_id: createLfgComponentId('join', post.id, componentSecret),
            disabled: !active || post.status === 'full',
          },
          {
            type: 2,
            style: 2,
            label: '辞退',
            custom_id: createLfgComponentId('leave', post.id, componentSecret),
            disabled: !active,
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/** Discord nonceの上限25文字内で、同じ募集versionの再投稿を同一視する。 */
export function createLfgMessageNonce(postId: string, version: number): string {
  const compactId = postId.replaceAll('-', '').replace(/[^0-9a-f]/gi, '').slice(0, 16);
  const normalizedVersion = Number.isFinite(version) ? Math.max(0, Math.floor(version)) : 0;
  return `lfg${compactId.padEnd(16, '0')}${normalizedVersion.toString(36).slice(-6)}`.slice(0, 25);
}

export function formatLfgPostText(post: LfgPostRecord, participantIds: string[]): string {
  return [
    `**${escapeMarkdown(post.title)}**`,
    `ゲーム・イベント: ${escapeMarkdown(post.game)}`,
    `状態: ${post.status}`,
    `参加人数: ${post.participantCount}/${post.maxPlayers}`,
    `開始予定: ${post.startTime ? discordTimestamp(post.startTime) : '未指定'}`,
    `募集期限: ${discordTimestamp(post.expiresAt)}`,
    `参加者: ${participantIds.length ? participantIds.map((id) => `<@${id}>`).join(' ') : 'なし'}`,
    `ID: \`${post.id}\``,
  ].join('\n');
}

function discordTimestamp(value: Date): string {
  return `<t:${Math.floor(value.getTime() / 1000)}:F>`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&');
}
