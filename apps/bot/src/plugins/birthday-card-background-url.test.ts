import { BIRTHDAY_CARD_BACKGROUND_MAX_BYTES } from '@herta/shared';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBirthdayCardBackgroundImage } from './birthday-card-background-url.js';

const BACKGROUND_URL = 'https://media.example.invalid/birthday/background.png';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBirthdayCardBackgroundImage', () => {
  it('httpsの有効な画像を取得して背景bytesとして採用する', async () => {
    const png = await createSolidPng(12, 34, 56);
    stubFetch(async () => new Response(toBody(png), { status: 200 }));

    const result = await fetchBirthdayCardBackgroundImage(BACKGROUND_URL);

    expect(result).not.toBeNull();
    expect(result?.equals(png)).toBe(true);
  });

  it('https以外のURLはfetchせずに拒否する', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 200 }));

    await expect(
      fetchBirthdayCardBackgroundImage('http://media.example.invalid/birthday/background.png'),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URLとして解釈できない文字列は拒否する', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 200 }));

    await expect(fetchBirthdayCardBackgroundImage('not a url')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('リダイレクト先がhttpsでなければ拒否する', async () => {
    const png = await createSolidPng(12, 34, 56);
    stubFetch(
      async () =>
        ({
          ok: true,
          status: 200,
          url: 'http://media.example.invalid/birthday/background.png',
          headers: new Headers(),
          body: new Response(toBody(png)).body,
        }) as unknown as Response,
    );

    await expect(fetchBirthdayCardBackgroundImage(BACKGROUND_URL)).resolves.toBeNull();
  });

  it('通信に失敗したらnullを返してフォールバック可能にする', async () => {
    stubFetch(async () => {
      throw new Error('network down');
    });

    await expect(fetchBirthdayCardBackgroundImage(BACKGROUND_URL)).resolves.toBeNull();
  });

  it('HTTPエラーならnullを返す', async () => {
    stubFetch(async () => new Response('not found', { status: 404 }));

    await expect(fetchBirthdayCardBackgroundImage(BACKGROUND_URL)).resolves.toBeNull();
  });

  it('画像でないバイト列は採用しない', async () => {
    stubFetch(
      async () =>
        new Response(new TextEncoder().encode('<html>not an image</html>'), { status: 200 }),
    );

    await expect(fetchBirthdayCardBackgroundImage(BACKGROUND_URL)).resolves.toBeNull();
  });

  it('headerだけ有効な切断PNGはsharpでdecodeできないため採用しない', async () => {
    const truncatedPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64');
    stubFetch(async () => new Response(toBody(truncatedPng), { status: 200 }));

    await expect(fetchBirthdayCardBackgroundImage(BACKGROUND_URL)).resolves.toBeNull();
  });

  it('宣言されたサイズが上限を超える場合は採用しない', async () => {
    const png = await createSolidPng(12, 34, 56);
    stubFetch(
      async () =>
        new Response(toBody(png), {
          status: 200,
          headers: { 'content-length': String(BIRTHDAY_CARD_BACKGROUND_MAX_BYTES + 1) },
        }),
    );

    await expect(fetchBirthdayCardBackgroundImage(BACKGROUND_URL)).resolves.toBeNull();
  });

  it('実ボディが上限を超える場合は採用しない', async () => {
    const oversized = Buffer.alloc(BIRTHDAY_CARD_BACKGROUND_MAX_BYTES + 1, 1);
    stubFetch(async () => new Response(toBody(oversized), { status: 200 }));

    await expect(fetchBirthdayCardBackgroundImage(BACKGROUND_URL)).resolves.toBeNull();
  });
});

function toBody(bytes: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function stubFetch(impl: (input: unknown) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function createSolidPng(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 100, height: 50, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}
