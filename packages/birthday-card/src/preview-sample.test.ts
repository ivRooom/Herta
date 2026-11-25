import { DEFAULT_BIRTHDAY_CARD_CONFIG } from '@herta/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderBirthdayCard } from './birthday-card.js';
import { BIRTHDAY_CARD_PREVIEW_SAMPLE, createBirthdayCardSampleAvatar } from './preview-sample.js';

describe('birthday card preview sample (#991 S3d-D2)', () => {
  it('sample avatar is a 512x512 PNG', async () => {
    const avatar = await createBirthdayCardSampleAvatar();
    const metadata = await sharp(avatar).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });

  it('avatarBytes are composed without an avatar URL', async () => {
    const card = await renderBirthdayCard({
      config: {
        ...DEFAULT_BIRTHDAY_CARD_CONFIG,
        birthdayCardBackgroundSource: 'preset',
        birthdayCardShowAvatar: true,
        birthdayCardShowName: true,
        birthdayCardShowBirthday: true,
        birthdayCardShowAge: false,
      },
      displayName: BIRTHDAY_CARD_PREVIEW_SAMPLE.displayName,
      avatarUrl: null,
      avatarBytes: await createBirthdayCardSampleAvatar(),
      month: BIRTHDAY_CARD_PREVIEW_SAMPLE.month,
      day: BIRTHDAY_CARD_PREVIEW_SAMPLE.day,
      age: null,
    });
    const metadata = await sharp(card).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1672);
    expect(metadata.height).toBe(941);
  });
});
