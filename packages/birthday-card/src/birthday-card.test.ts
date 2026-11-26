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

    const card = await renderWithCustomBackground(customBackground);
    const { data, info } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1672);
    expect(info.height).toBe(941);
    expect([...data.subarray(0, 3)]).toEqual([12, 34, 56]);
  });

  it('custom sourceでも不正なbytesなら安全に組み込みpresetへfallbackする', async () => {
    const card = await renderWithCustomBackground(new TextEncoder().encode('<svg></svg>'));
    await expectValidBirthdayCard(card);
  });

  it('headerだけ有効な切断PNGでもdecode失敗時に安全にfallbackする', async () => {
    const truncatedPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64');
    const card = await renderWithCustomBackground(truncatedPng);
    await expectValidBirthdayCard(card);
  });

  it('headerだけ有効なWebPでもdecode失敗時に安全にfallbackする', async () => {
    const headerOnlyWebp = Buffer.from('UklGRgAAAABXRUJQVlA4WAAAAAAAAAAAAAAAAAAA', 'base64');
    const card = await renderWithCustomBackground(headerOnlyWebp);
    await expectValidBirthdayCard(card);
  });
});

describe('renderBirthdayCard remote background (#986 S5c)', () => {
  it('preset sourceでもAPI背景URLの画像を背景として使用する', async () => {
    const remoteBackground = await createSolidPng(200, 30, 40);

    const card = await renderWithBackgrounds({ remoteBackground });
    const { data } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([200, 30, 40]);
  });

  it('API背景URLの画像はStudio保存済みcustom背景より優先される', async () => {
    const remoteBackground = await createSolidPng(200, 30, 40);
    const customBackground = await createSolidPng(12, 34, 56);

    const card = await renderWithBackgrounds({
      backgroundSource: 'custom',
      remoteBackground,
      customBackground,
    });
    const { data } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([200, 30, 40]);
  });

  it('API背景URLの画像が不正なbytesならcustom背景へfallbackする', async () => {
    const customBackground = await createSolidPng(12, 34, 56);

    const card = await renderWithBackgrounds({
      backgroundSource: 'custom',
      remoteBackground: new TextEncoder().encode('<svg></svg>'),
      customBackground,
    });
    const { data } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([12, 34, 56]);
  });
});

describe('renderBirthdayCard preset definition (#1028 R3-E)', () => {
  const definition = {
    id: 'my-custom-preset',
    label: 'カスタムプリセット',
    backgroundUrl: 'https://media.example.com/birthday/bg.webp',
    textColor: '#ff0000',
    textStroke: '#0000ff',
  };

  it('定義の背景bytesを背景として使用する', async () => {
    const definitionBackground = await createSolidPng(10, 220, 30);

    const card = await renderWithBackgrounds({
      presetDefinition: definition,
      definitionBackground,
    });
    const { data } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([10, 220, 30]);
  });

  it('背景はcard.backgroundUrlの画像が定義の背景より優先される', async () => {
    const remoteBackground = await createSolidPng(200, 30, 40);
    const definitionBackground = await createSolidPng(10, 220, 30);

    const card = await renderWithBackgrounds({
      presetDefinition: definition,
      remoteBackground,
      definitionBackground,
    });
    const { data } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([200, 30, 40]);
  });

  it('定義の背景bytesが不正なら保存済みcustom背景へfallbackする', async () => {
    const customBackground = await createSolidPng(12, 34, 56);

    const card = await renderWithBackgrounds({
      backgroundSource: 'custom',
      presetDefinition: definition,
      definitionBackground: new TextEncoder().encode('<svg></svg>'),
      customBackground,
    });
    const { data } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([12, 34, 56]);
  });

  it('定義の文字色でテキストを描く（背景が定義外でも色は定義に従う）', async () => {
    const withDefinition = await renderWithBackgrounds({
      showName: true,
      presetDefinition: definition,
    });
    const withoutDefinition = await renderWithBackgrounds({ showName: true });

    const { data, info } = await sharp(withDefinition).raw().toBuffer({ resolveWithObject: true });
    let redPixels = 0;
    for (let index = 0; index + 2 < data.length; index += info.channels) {
      if (data[index] === 255 && data[index + 1] === 0 && data[index + 2] === 0) redPixels += 1;
    }
    expect(redPixels).toBeGreaterThan(0);
    expect(Buffer.from(withDefinition).equals(Buffer.from(withoutDefinition))).toBe(false);
  });

  it('定義がnullなら従来と同一に描画される', async () => {
    const plain = await renderWithBackgrounds({});
    const withNulls = await renderWithBackgrounds({
      presetDefinition: null,
      definitionBackground: null,
    });
    expect(Buffer.from(withNulls).equals(Buffer.from(plain))).toBe(true);
  });
});

function renderWithCustomBackground(customBackground: Uint8Array) {
  return renderBirthdayCard({
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
}

function renderWithBackgrounds(input: {
  backgroundSource?: 'preset' | 'custom' | 'asset';
  remoteBackground?: Uint8Array | null;
  customBackground?: Uint8Array | null;
  presetDefinition?: {
    id: string;
    label: string;
    backgroundUrl: string;
    textColor: string;
    textStroke: string;
  } | null;
  definitionBackground?: Uint8Array | null;
  showName?: boolean;
}) {
  return renderBirthdayCard({
    config: {
      ...DEFAULT_BIRTHDAY_CARD_CONFIG,
      birthdayCardBackgroundSource: input.backgroundSource ?? 'preset',
      birthdayCardShowAvatar: false,
      birthdayCardShowName: input.showName ?? false,
      birthdayCardShowBirthday: false,
      birthdayCardShowAge: false,
    },
    displayName: 'Herta Member',
    avatarUrl: null,
    month: 8,
    day: 19,
    age: 25,
    customBackground: input.customBackground ?? null,
    remoteBackground: input.remoteBackground ?? null,
    presetDefinition: input.presetDefinition ?? null,
    definitionBackground: input.definitionBackground ?? null,
  });
}

async function createSolidPng(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 1672, height: 941, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

async function expectValidBirthdayCard(card: Uint8Array) {
  const metadata = await sharp(card).metadata();
  expect(metadata.width).toBe(1672);
  expect(metadata.height).toBe(941);
  expect(metadata.format).toBe('png');
}
