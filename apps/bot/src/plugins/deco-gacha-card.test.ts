import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  DECO_CARD_HEIGHT,
  DECO_CARD_WIDTH,
  fetchDecoCardImage,
  renderDecoProfileCard,
} from './deco-gacha-card.js';

async function solidPng(
  color: { r: number; g: number; b: number },
  width = 800,
  height = 450,
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { ...color, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

async function framePng(): Promise<Buffer> {
  const size = 480;
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="${size - 12}" height="${size - 12}" rx="60" fill="none" stroke="#ffd166" stroke-width="12"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('deco profile card', () => {
  it('renders a 1672x941 PNG from the fallback paper with no images at all', async () => {
    const buffer = await renderDecoProfileCard({
      displayName: 'テストメンバー',
      titleName: null,
      fortuneLabel: null,
    });
    expect(await sharp(buffer).metadata()).toMatchObject({
      width: DECO_CARD_WIDTH,
      height: DECO_CARD_HEIGHT,
      format: 'png',
    });
  });

  it('composites cover, skin, frame, avatar, title and fortune badge', async () => {
    const buffer = await renderDecoProfileCard({
      displayName: '星詠みメンバー',
      avatarBytes: await solidPng({ r: 122, g: 162, b: 255 }, 256, 256),
      coverBytes: await solidPng({ r: 34, g: 51, b: 102 }),
      skinBytes: await framePng(),
      frameBytes: await framePng(),
      titleName: '星詠み',
      fortuneLabel: '大吉',
      fortuneColor: '#f5c542',
    });
    expect(await sharp(buffer).metadata()).toMatchObject({
      width: DECO_CARD_WIDTH,
      height: DECO_CARD_HEIGHT,
      format: 'png',
    });
    expect(buffer.byteLength).toBeLessThan(10 * 1024 * 1024);
  });

  it('uses the skin as the base paper when no cover is equipped', async () => {
    const buffer = await renderDecoProfileCard({
      displayName: 'Member',
      skinBytes: await solidPng({ r: 51, g: 68, b: 85 }),
      titleName: '夜更かし観測者',
      fortuneLabel: '末吉',
    });
    expect(await sharp(buffer).metadata()).toMatchObject({
      width: DECO_CARD_WIDTH,
      height: DECO_CARD_HEIGHT,
      format: 'png',
    });
  });

  it('survives corrupt image bytes by dropping only those layers', async () => {
    const buffer = await renderDecoProfileCard({
      displayName: '<svg>&" hostile',
      avatarBytes: Buffer.from('not an image'),
      coverBytes: Buffer.from('not an image'),
      skinBytes: Buffer.from('not an image'),
      frameBytes: Buffer.from('not an image'),
      titleName: '称号<test>',
      fortuneLabel: '吉',
    });
    expect(await sharp(buffer).metadata()).toMatchObject({
      width: DECO_CARD_WIDTH,
      height: DECO_CARD_HEIGHT,
      format: 'png',
    });
  });
});

describe('fetchDecoCardImage', () => {
  it('rejects null, relative and non-https URLs without fetching', async () => {
    expect(await fetchDecoCardImage(null)).toBeNull();
    expect(await fetchDecoCardImage('/media/deco/frame.png')).toBeNull();
    expect(await fetchDecoCardImage('http://example.com/frame.png')).toBeNull();
    expect(await fetchDecoCardImage('not a url')).toBeNull();
  });

  it('returns null when the fetch fails', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    try {
      expect(await fetchDecoCardImage('https://example.com/frame.png')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('returns the bytes of a decodable https image', async () => {
    const png = await solidPng({ r: 68, g: 85, b: 102 }, 64, 64);
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(new Uint8Array(png), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    try {
      const result = await fetchDecoCardImage('https://example.com/frame.png');
      expect(result).not.toBeNull();
      expect(result!.byteLength).toBe(png.byteLength);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects an https payload that is not a decodable image', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('plain text', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    try {
      expect(await fetchDecoCardImage('https://example.com/frame.png')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
