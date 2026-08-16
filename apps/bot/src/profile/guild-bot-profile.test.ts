import { Routes, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  getGuildBotProfile,
  parseGuildBotProfileUpdate,
  updateGuildBotProfile,
} from './guild-bot-profile.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GUILD_ID = '964326043420872704';
const BOT_USER_ID = '123456789012345678';

function createClientMock() {
  const get = vi.fn().mockResolvedValue({
    nick: 'Herta',
    avatar: null,
    user: { id: BOT_USER_ID, username: 'Herta', avatar: null },
  });
  const patch = vi.fn().mockResolvedValue({
    nick: 'Herta Updated',
    avatar: null,
    user: { id: BOT_USER_ID, username: 'Herta', avatar: null },
  });

  const client = {
    user: { id: BOT_USER_ID },
    guilds: { cache: new Map([[GUILD_ID, {}]]) },
    rest: { get, patch },
  } as unknown as Client;

  return { client, get, patch };
}

describe('Guild Bot Profile Discord REST', () => {
  it('取得時はBot自身のsnowflakeを使用する', async () => {
    const { client, get } = createClientMock();

    await expect(getGuildBotProfile(client, GUILD_ID)).resolves.toMatchObject({
      userId: BOT_USER_ID,
      nickname: 'Herta',
    });
    expect(get).toHaveBeenCalledWith(Routes.guildMember(GUILD_ID, BOT_USER_ID));
  });

  it('更新時はModify Current Memberの@me routeを使用する', async () => {
    const { client, patch } = createClientMock();

    await expect(
      updateGuildBotProfile(client, GUILD_ID, { nickname: 'Herta Updated' }),
    ).resolves.toMatchObject({
      userId: BOT_USER_ID,
      nickname: 'Herta Updated',
    });
    expect(patch).toHaveBeenCalledWith(Routes.guildMember(GUILD_ID, '@me'), {
      body: { nick: 'Herta Updated' },
    });
  });

  it('Botログイン前はDiscord RESTを呼ばずnullを返す', async () => {
    const get = vi.fn();
    const patch = vi.fn();
    const client = {
      user: null,
      guilds: { cache: new Map([[GUILD_ID, {}]]) },
      rest: { get, patch },
    } as unknown as Client;

    await expect(getGuildBotProfile(client, GUILD_ID)).resolves.toBeNull();
    await expect(
      updateGuildBotProfile(client, GUILD_ID, { nickname: 'Herta' }),
    ).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('parseGuildBotProfileUpdate', () => {
  it('Nicknameのみの更新を受け付ける', () => {
    expect(parseGuildBotProfileUpdate({ nickname: 'Herta' })).toEqual({ nickname: 'Herta' });
    expect(parseGuildBotProfileUpdate({ nickname: null })).toEqual({ nickname: null });
  });

  it('Avatarの置換とリセットを受け付ける', () => {
    expect(
      parseGuildBotProfileUpdate({
        nickname: 'Herta',
        avatar: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toEqual({
      nickname: 'Herta',
      avatar: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(parseGuildBotProfileUpdate({ nickname: 'Herta', avatar: null })).toEqual({
      nickname: 'Herta',
      avatar: null,
    });
  });

  it('長すぎるNicknameと不正なAvatarを拒否する', () => {
    expect(parseGuildBotProfileUpdate({ nickname: 'x'.repeat(33) })).toBeNull();
    expect(
      parseGuildBotProfileUpdate({ nickname: 'Herta', avatar: 'data:text/plain;base64,SGVsbG8=' }),
    ).toBeNull();
    expect(
      parseGuildBotProfileUpdate({ nickname: 'Herta', avatar: 'data:image/png;base64,not base64' }),
    ).toBeNull();
  });

  it('宣言MIMEと画像signatureが一致しないAvatarを拒否する', () => {
    const gifBytes = Buffer.from('GIF89a', 'ascii').toString('base64');
    expect(
      parseGuildBotProfileUpdate({
        nickname: 'Herta',
        avatar: `data:image/png;base64,${gifBytes}`,
      }),
    ).toBeNull();
  });

  it('デコード後に1MiBを超えるAvatarを拒否する', () => {
    const oversized = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(1024 * 1024)]).toString('base64');
    expect(
      parseGuildBotProfileUpdate({
        nickname: 'Herta',
        avatar: `data:image/png;base64,${oversized}`,
      }),
    ).toBeNull();
  });
});
