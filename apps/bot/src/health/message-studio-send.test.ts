import { describe, expect, it } from 'vitest';
import { parseGuildMessageStudioSendInput } from './message-studio-send.js';

describe('parseGuildMessageStudioSendInput', () => {
  it('本文だけの安全な投稿を受理する', () => {
    expect(
      parseGuildMessageStudioSendInput({
        channelId: '123456789012345678',
        content: '**Hello**',
        forumTitle: '',
        allowUserMentions: false,
        publishAnnouncement: false,
        embed: null,
        image: null,
      }),
    ).toMatchObject({
      channelId: '123456789012345678',
      content: '**Hello**',
      allowUserMentions: false,
    });
  });

  it('PNG画像だけの投稿を受理する', () => {
    expect(
      parseGuildMessageStudioSendInput({
        channelId: '123456789012345678',
        content: '',
        forumTitle: '画像投稿',
        allowUserMentions: true,
        publishAnnouncement: false,
        embed: null,
        image: {
          filename: 'image.png',
          contentType: 'image/png',
          dataBase64: Buffer.from('test-image').toString('base64'),
        },
      }),
    ).not.toBeNull();
  });

  it('Embedだけの投稿を受理する', () => {
    expect(
      parseGuildMessageStudioSendInput({
        channelId: '123456789012345678',
        content: '',
        forumTitle: '',
        allowUserMentions: false,
        publishAnnouncement: false,
        embed: {
          title: 'お知らせ',
          description: '**メンテナンス**を実施します',
          color: '#5865F2',
          imageUrl: 'https://example.com/banner.png',
          thumbnailUrl: '',
          footerText: 'Herta Operations',
          fields: [{ name: '開始', value: '21:00', inline: true }],
        },
        image: null,
      }),
    ).toMatchObject({
      embed: {
        title: 'お知らせ',
        color: '#5865F2',
        fields: [{ name: '開始', value: '21:00', inline: true }],
      },
    });
  });

  it('不正なEmbed URL・色・空Embedを拒否する', () => {
    const base = {
      channelId: '123456789012345678',
      content: '',
      forumTitle: '',
      allowUserMentions: false,
      publishAnnouncement: false,
      image: null,
    };
    expect(
      parseGuildMessageStudioSendInput({
        ...base,
        embed: {
          title: 'x',
          description: '',
          color: 'red',
          imageUrl: '',
          thumbnailUrl: '',
          footerText: '',
          fields: [],
        },
      }),
    ).toBeNull();
    expect(
      parseGuildMessageStudioSendInput({
        ...base,
        embed: {
          title: 'x',
          description: '',
          color: '#5865F2',
          imageUrl: 'javascript:alert(1)',
          thumbnailUrl: '',
          footerText: '',
          fields: [],
        },
      }),
    ).toBeNull();
    expect(
      parseGuildMessageStudioSendInput({
        ...base,
        embed: {
          title: '',
          description: '',
          color: '#5865F2',
          imageUrl: '',
          thumbnailUrl: '',
          footerText: '',
          fields: [],
        },
      }),
    ).toBeNull();
  });

  it('投稿先・MIME・空投稿・過大画像を拒否する', () => {
    const base = {
      channelId: '123456789012345678',
      content: 'hello',
      forumTitle: '',
      allowUserMentions: false,
      publishAnnouncement: false,
      embed: null,
    };
    expect(
      parseGuildMessageStudioSendInput({ ...base, channelId: '../invalid', image: null }),
    ).toBeNull();
    expect(
      parseGuildMessageStudioSendInput({ ...base, content: '', embed: null, image: null }),
    ).toBeNull();
    expect(
      parseGuildMessageStudioSendInput({
        ...base,
        image: {
          filename: 'payload.svg',
          contentType: 'image/svg+xml',
          dataBase64: Buffer.from('<svg/>').toString('base64'),
        },
      }),
    ).toBeNull();
    expect(
      parseGuildMessageStudioSendInput({
        ...base,
        image: {
          filename: 'large.png',
          contentType: 'image/png',
          dataBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64'),
        },
      }),
    ).toBeNull();
  });
});
