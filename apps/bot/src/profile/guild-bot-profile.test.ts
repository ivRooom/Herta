import { describe, expect, it } from 'vitest';
import { parseGuildBotProfileUpdate } from './guild-bot-profile.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
