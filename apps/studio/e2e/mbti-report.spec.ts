import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const reportUrl = '/mbti/result?v=1&ei=-12&sn=-14&tf=-10&jp=-8&at=-6';

test('full report, score-only sharing and PNG export work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(reportUrl);
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
