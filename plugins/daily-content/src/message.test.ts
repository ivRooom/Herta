import { describe, expect, it } from 'vitest';
import {
  formatMessageStudioWeekdays,
  parseDiscordMessageUrl,
  parseMessageStudioWeekdays,
  toDiscordApiEmbed,
} from './message.js';

describe('Message Studio message helpers', () => {
  it('DiscordメッセージURLを同一構造へ分解する', () => {
    expect(
      parseDiscordMessageUrl(
        'https://discord.com/channels/123456789012345678/223456789012345678/323456789012345678',
      ),
    ).toEqual({
      guildId: '123456789012345678',
      channelId: '223456789012345678',
      messageId: '323456789012345678',
    });
  });

  it('Discord以外のURLを拒否する', () => {
    expect(() => parseDiscordMessageUrl('https://example.com/message/1')).toThrow(
      'DiscordメッセージURLの形式が不正です',
    );
  });

  it('日本語・英語・数字の曜日を正規化する', () => {
    expect(parseMessageStudioWeekdays('月, Wed, 5, 月')).toEqual([1, 3, 5]);
    expect(formatMessageStudioWeekdays([1, 3, 5])).toBe('月・水・金');
  });

  it('EmbedをDiscord API形式へ変換する', () => {
    expect(
      toDiscordApiEmbed({
        title: 'Announcement',
        description: '**Markdown**',
        color: '#5865F2',
        imageUrl: 'https://example.com/image.png',
        thumbnailUrl: 'https://example.com/thumb.png',
        footerText: 'Herta',
        fields: [{ name: 'Status', value: 'Ready', inline: true }],
      }),
    ).toEqual({
      title: 'Announcement',
      description: '**Markdown**',
      color: 0x5865f2,
      image: { url: 'https://example.com/image.png' },
      thumbnail: { url: 'https://example.com/thumb.png' },
      footer: { text: 'Herta' },
      fields: [{ name: 'Status', value: 'Ready', inline: true }],
    });
  });
});
