import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  DAILY_RESULT_CARD_MAX_ANIMATED_FRAMES,
  renderDailyResultCard,
  renderDailyResultCardAttachment,
} from './daily-result-card.js';

async function artwork(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 70, b: 160 } },
  })
    .png()
    .toBuffer();
}

async function animatedArtwork(format: 'webp' | 'gif', frames = 3): Promise<Buffer> {
  const colors = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ];
  const buffers = await Promise.all(
    colors.slice(0, frames).map((background) =>
      sharp({ create: { width: 800, height: 600, channels: 3, background } })
        .png()
        .toBuffer(),
    ),
  );
  const joined = sharp(buffers, { join: { animated: true } });
  return format === 'webp'
    ? joined.webp({ delay: [120, 120, 120] }).toBuffer()
    : joined.gif({ delay: [120, 120, 120] }).toBuffer();
}

describe('daily result card renderer', () => {
  it('renders a bounded 1000x730 PNG for a correct result', async () => {
    const card = await renderDailyResultCard({
      result: 'correct',
      rewardPoints: 10,
      balance: 691,
      artwork: await artwork(),
    });
    expect(await sharp(card).metadata()).toMatchObject({
      width: 1000,
      height: 730,
      format: 'png',
    });
    expect(card.byteLength).toBeLessThan(4 * 1024 * 1024);
  });

  it('renders zero and very large point values without failing', async () => {
    const zero = await renderDailyResultCard({
      result: 'incorrect',
      rewardPoints: 0,
      balance: 0,
      artwork: await artwork(400, 900),
    });
    expect(await sharp(zero).metadata()).toMatchObject({ format: 'png' });
    const large = await renderDailyResultCard({
      result: 'correct',
      rewardPoints: 100_000,
      balance: Number.MAX_SAFE_INTEGER,
      artwork: await artwork(1600, 200),
    });
    expect(await sharp(large).metadata()).toMatchObject({ format: 'png' });
  });

  it('rejects artwork that is not a decodable image', async () => {
    await expect(
      renderDailyResultCard({
        result: 'correct',
        rewardPoints: 10,
        balance: 10,
        artwork: Buffer.from('not an image'),
      }),
    ).rejects.toThrow();
  });

  it('keeps still artwork on the PNG attachment', async () => {
    const card = await renderDailyResultCardAttachment({
      result: 'correct',
      rewardPoints: 10,
      balance: 691,
      artwork: await artwork(),
    });
    expect(card.fileName).toBe('herta-daily-result.png');
    expect(await sharp(card.data).metadata()).toMatchObject({
      width: 1000,
      height: 730,
      format: 'png',
    });
  });

  it.each(['webp', 'gif'] as const)(
    'renders animated %s artwork as an animated WebP card with every frame composited',
    async (format) => {
      const card = await renderDailyResultCardAttachment({
        result: 'incorrect',
        rewardPoints: 0,
        balance: 691,
        artwork: await animatedArtwork(format),
      });
      expect(card.fileName).toBe('herta-daily-result.webp');
      const meta = await sharp(card.data, { animated: true }).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: 1000, pageHeight: 730, pages: 3 });
      expect(meta.delay).toEqual([120, 120, 120]);
      // Frame 2 (green artwork) shows through the artwork window centre,
      // while the window corner stays card background (rounded clipping).
      const frame = await sharp(card.data, { page: 1 }).raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => {
        const i = (y * frame.info.width + x) * frame.info.channels;
        return [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
      };
      // WebP encoding is lossy, so compare with a small tolerance.
      const centre = pixel(500, 287);
      expect(centre[0]).toBeLessThan(10);
      expect(centre[1]).toBeGreaterThan(245);
      expect(centre[2]).toBeLessThan(10);
      const corner = pixel(60, 106);
      expect(Math.abs(corner[0]! - 16)).toBeLessThanOrEqual(2);
      expect(Math.abs(corner[1]! - 22)).toBeLessThanOrEqual(2);
      expect(Math.abs(corner[2]! - 32)).toBeLessThanOrEqual(2);
    },
  );

  it('flattens animated artwork to a still PNG through the legacy renderer', async () => {
    const card = await renderDailyResultCard({
      result: 'correct',
      rewardPoints: 10,
      balance: 691,
      artwork: await animatedArtwork('webp'),
    });
    const meta = await sharp(card).metadata();
    expect(meta.format).toBe('png');
    expect(meta.pages ?? 1).toBe(1);
  });

  it('falls back to a still card when artwork exceeds the animated frame bound', async () => {
    const count = DAILY_RESULT_CARD_MAX_ANIMATED_FRAMES + 1;
    const buffers = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        sharp({
          create: {
            width: 16,
            height: 16,
            channels: 3,
            background: { r: (i * 37) % 256, g: (i * 91) % 256, b: (i * 53) % 256 },
          },
        })
          .png()
          .toBuffer(),
      ),
    );
    const animated = await sharp(buffers, { join: { animated: true } })
      .webp({ delay: Array.from({ length: count }, () => 50) })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(count);
    const card = await renderDailyResultCardAttachment({
      result: 'correct',
      rewardPoints: 10,
      balance: 691,
      artwork: animated,
    });
    expect(card.fileName).toBe('herta-daily-result.png');
    expect((await sharp(card.data).metadata()).format).toBe('png');
  });
});
