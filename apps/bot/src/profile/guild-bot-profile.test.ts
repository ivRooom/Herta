import { describe, expect, it } from 'vitest';
import { parseGuildBotProfileUpdate } from './guild-bot-profile.js';

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
});
