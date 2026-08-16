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
        image: {
          filename: 'image.png',
          contentType: 'image/png',
          dataBase64: Buffer.from('test-image').toString('base64'),
        },
      }),
    ).not.toBeNull();
  });

  it('投稿先・MIME・空投稿・過大画像を拒否する', () => {
    const base = {
      channelId: '123456789012345678',
      content: 'hello',
      forumTitle: '',
      allowUserMentions: false,
      publishAnnouncement: false,
    };
    expect(parseGuildMessageStudioSendInput({ ...base, channelId: '../invalid', image: null })).toBeNull();
    expect(parseGuildMessageStudioSendInput({ ...base, content: '', image: null })).toBeNull();
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
