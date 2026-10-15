import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const reportUrl = '/mbti/result?v=1&ei=-12&sn=-14&tf=-10&jp=-8&at=-6';

test('full report, score-only sharing and PNG export work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(reportUrl);
  await expect(
    page.getByRole('img', { name: '仲介者のイメージ：開いた本と花のアーチがある空想の庭' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '共有された診断レポート' })).toBeVisible();
  for (const name of [
    '活かしやすい強み',
    '気をつけたい場面',
    '人との関わり方',
    '日常で試せること',
  ]) {
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: '共有リンクをコピー' }).click();
  const link = await page.getByRole('textbox', { name: '共有リンク' }).inputValue();
  const url = new URL(link);
  expect([...url.searchParams.keys()]).toEqual(['v', 'ei', 'sn', 'tf', 'jp', 'at']);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '画像で保存', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('herta-INFP-T.png');
  const path = await download.path();
  expect(path).not.toBeNull();
  const png = await readFile(path!);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBeGreaterThan(2500);
  // Verify the exported image actually contains illustration pixels, not an empty reserved area.
  const coloredPixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 360;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 648, 95, 360, 360, 0, 0, 360, 360);
    const pixels = ctx.getImageData(0, 0, 360, 360).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! > 100 && pixels[i + 1]! > 80) count++;
    }
    return count;
  }, png.toString('base64'));
  expect(coloredPixels).toBeGreaterThan(1000);
  await page.goto(link);
  await expect(page.locator('.mbti-report-type')).toHaveText('INFP-T');
  expect(errors).toEqual([]);
});

test('mobile report has no horizontal overflow and balanced scores get careful explanations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mbti/result?v=1&ei=0&sn=0&tf=0&jp=0&at=0');
  await expect(page.locator('.mbti-boundary-note')).toBeVisible();
  await expect(page.getByText('両方の傾向が近い', { exact: true })).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await expect(page.getByRole('button', { name: '画像で保存', exact: true })).toBeVisible();
});

test('invalid or polluted share links are rejected', async ({ page }) => {
  for (const query of [
    'v=1&ei=99&sn=0&tf=0&jp=0&at=0',
    'v=1&ei=0&ei=1&sn=0&tf=0&jp=0&at=0',
    'v=1&ei=0&sn=0&tf=0&jp=0&at=0&sessionId=private',
  ]) {
    await page.goto(`/mbti/result?${query}`);
    await expect(page.getByRole('heading', { name: '共有リンクが正しくありません' })).toBeVisible();
    await expect(page.getByRole('button', { name: '画像で保存', exact: true })).toHaveCount(0);
  }
});

test('all 16 types use distinct artwork and reduced motion is respected', async ({ page }) => {
  const positions = new Set<string>();
  for (let bits = 0; bits < 16; bits++) {
    const values = Array.from({ length: 4 }, (_, i) => ((bits >> i) & 1 ? 12 : -12));
    await page.goto(
      `/mbti/result?v=1&ei=${values[0]}&sn=${values[1]}&tf=${values[2]}&jp=${values[3]}&at=8`,
    );
    const art = page.getByRole('img', { name: /のイメージ：/ });
    await expect(art).toBeVisible();
    const type = (await page.locator('.mbti-report-type').innerText()).slice(0, 4);
    await expect(art).toHaveAttribute('data-type', type);
    positions.add(await art.evaluate((el) => getComputedStyle(el).backgroundPosition));
  }
  expect(positions.size).toBe(16);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .getByRole('img', { name: /のイメージ：/ })
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});

test('PNG export still succeeds when illustration is unavailable', async ({ page }) => {
  await page.route('**/mbti/personality-worlds-v1.webp', (route) => route.abort());
  await page.goto(reportUrl);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '画像で保存', exact: true }).click();
  const file = await downloaded;
  expect(await file.failure()).toBeNull();
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});
