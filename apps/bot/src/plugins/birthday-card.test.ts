import { DEFAULT_BIRTHDAY_CARD_CONFIG } from '@herta/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderBirthdayCard } from './birthday-card.js';

describe('renderBirthdayCard custom background', () => {
  it('custom sourceでは検証済み画像をCard背景として使用する', async () => {
    const customBackground = await sharp({
      create: {
        width: 1672,
        height: 941,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    })
      .png()
      .toBuffer();

    const card = await renderBirthdayCard({
      config: {
        ...DEFAULT_BIRTHDAY_CARD_CONFIG,
        birthdayCardBackgroundSource: 'custom',
        birthdayCardShowAvatar: false,
        birthdayCardShowName: false,
        birthdayCardShowBirthday: false,
        birthdayCardShowAge: false,
      },
      displayName: 'Herta Member',
      avatarUrl: null,
      month: 8,
      day: 19,
      age: 25,
      customBackground,
    });

    const { data, info } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1672);
    expect(info.height).toBe(941);
    expect([...data.subarray(0, 3)]).toEqual([12, 34, 56]);
  });

  it('custom sourceでも不正なbytesなら安全に組み込みpresetへfallbackする', async () => {
    const card = await renderBirthdayCard({
      config: {
        ...DEFAULT_BIRTHDAY_CARD_CONFIG,
        birthdayCardBackgroundSource: 'custom',
        birthdayCardShowAvatar: false,
        birthdayCardShowName: false,
        birthdayCardShowBirthday: false,
        birthdayCardShowAge: false,
      },
      displayName: 'Herta Member',
      avatarUrl: null,
      month: 8,
      day: 19,
      age: 25,
      customBackground: new TextEncoder().encode('<svg></svg>'),
    });

    const metadata = await sharp(card).metadata();
    expect(metadata.width).toBe(1672);
    expect(metadata.height).toBe(941);
    expect(metadata.format).toBe('png');
  });
});
