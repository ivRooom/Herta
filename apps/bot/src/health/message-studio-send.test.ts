import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseGuildMessageStudioSendInput,
  sendGuildMessageStudioMessage,
  type GuildMessageStudioSendInput,
} from './message-studio-send.js';

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
        voice: null,
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
        voice: null,
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
        voice: null,
      }),
    ).toMatchObject({
      embed: {
        title: 'お知らせ',
        color: '#5865F2',
        fields: [{ name: '開始', value: '21:00', inline: true }],
      },
    });
  });

  it('Voice Messageを受理する', () => {
    const waveform = Buffer.from([0, 32, 96, 255]).toString('base64');
    expect(
      parseGuildMessageStudioSendInput({
        channelId: '123456789012345678',
        content: '',
        forumTitle: '',
        allowUserMentions: false,
        publishAnnouncement: false,
        embed: null,
        image: null,
        voice: {
          filename: 'voice.ogg',
          contentType: 'audio/ogg',
          dataBase64: Buffer.from('audio-data').toString('base64'),
          durationSeconds: 3.25,
          waveform,
        },
      }),
    ).toMatchObject({
      voice: { filename: 'voice.ogg', contentType: 'audio/ogg', durationSeconds: 3.25, waveform },
    });
  });

  it('Voice Messageと本文・Embed・画像・Crosspostの併用を拒否する', () => {
    const voice = {
      filename: 'voice.ogg',
      contentType: 'audio/ogg',
      dataBase64: Buffer.from('audio-data').toString('base64'),
      durationSeconds: 2,
      waveform: Buffer.from([12, 80]).toString('base64'),
    };
    const base = {
      channelId: '123456789012345678',
      forumTitle: '',
      allowUserMentions: false,
      embed: null,
      image: null,
      voice,
    };
    expect(
      parseGuildMessageStudioSendInput({ ...base, content: 'hello', publishAnnouncement: false }),
    ).toBeNull();
    expect(
      parseGuildMessageStudioSendInput({ ...base, content: '', publishAnnouncement: true }),
    ).toBeNull();
  });

  it('不正なVoice MIME・duration・waveformを拒否する', () => {
    const base = {
      channelId: '123456789012345678',
      content: '',
      forumTitle: '',
      allowUserMentions: false,
      publishAnnouncement: false,
      embed: null,
      image: null,
    };
    const voice = {
      filename: 'voice.bin',
      contentType: 'application/octet-stream',
      dataBase64: Buffer.from('audio-data').toString('base64'),
      durationSeconds: 2,
      waveform: Buffer.from([10]).toString('base64'),
    };
    expect(parseGuildMessageStudioSendInput({ ...base, voice })).toBeNull();
    expect(
      parseGuildMessageStudioSendInput({
        ...base,
        voice: { ...voice, contentType: 'audio/ogg', durationSeconds: 0 },
      }),
    ).toBeNull();
    expect(
      parseGuildMessageStudioSendInput({
        ...base,
        voice: { ...voice, contentType: 'audio/ogg', waveform: 'not-base64!' },
      }),
    ).toBeNull();
  });

  it('不正なEmbed URL・色・空Embedを拒否する', () => {
    const base = {
      channelId: '123456789012345678',
      content: '',
      forumTitle: '',
      allowUserMentions: false,
      publishAnnouncement: false,
      image: null,
      voice: null,
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
      voice: null,
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

const guildId = '123456789012345678';
const threadId = '223456789012345678';

function textMessageInput(): GuildMessageStudioSendInput {
  return {
    channelId: threadId,
    content: 'hello',
    forumTitle: '',
    allowUserMentions: false,
    publishAnnouncement: false,
    embed: null,
    image: null,
    voice: null,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendGuildMessageStudioMessage thread safety', () => {
  it('archived Threadを再開してから投稿する', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: threadId,
          guild_id: guildId,
          type: 11,
          thread_metadata: { archived: true, locked: false },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: '323456789012345678' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendGuildMessageStudioMessage('token', guildId, textMessageInput())).resolves.toEqual({
      messageId: '323456789012345678',
      channelId: threadId,
      threadId: null,
      channelType: 11,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`https://discord.com/api/v10/channels/${threadId}`);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `https://discord.com/api/v10/channels/${threadId}/messages`,
    );
  });

  it('locked Threadは再開も投稿もせず409で拒否する', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        id: threadId,
        guild_id: guildId,
        type: 11,
        thread_metadata: { archived: true, locked: true },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendGuildMessageStudioMessage('token', guildId, textMessageInput()),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('別GuildのThreadはDiscord再検証後に403で拒否する', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        id: threadId,
        guild_id: '923456789012345678',
        type: 11,
        thread_metadata: { archived: false, locked: false },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendGuildMessageStudioMessage('token', guildId, textMessageInput()),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
