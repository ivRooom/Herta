import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderDailyResultCard } from './daily-result-card.js';

async function artwork(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 70, b: 160 } },
  })
    .png()
    .toBuffer();
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
});
