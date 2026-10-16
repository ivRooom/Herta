import { expect, test } from '@playwright/test';
const enabled = process.env.HERTA_MBTI_HISTORY_E2E === '1';
let prisma: import('@herta/db').PrismaClient;
const subject = { guildId: 'mbti-e2e-test', discordUserId: 'mbti-e2e-user' };
let path = '';
let otherId = '';
let oldestId = '';
test.describe('private MBTI history', () => {
  test.skip(!enabled, 'Requires isolated local PostgreSQL fixture');
  test.beforeAll(async () => {
    const { PrismaClient, issueMbtiResultAccess, saveMbtiPersonalResult } =
      await import('@herta/db');
    const { computeMbtiIdentity, computeMbtiType, createMbtiScoreSnapshot } =
      await import('@herta/shared/mbti-core');
    prisma = new PrismaClient();
    const url = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1']).toContain(url.hostname);
    expect(url.pathname).toBe('/mbti_personal_test');
    await prisma.mbtiPersonalResult.deleteMany({ where: { guildId: subject.guildId } });
    const fixtures = [
      { scores: { EI: -10, SN: -10, TF: 10, JP: 10, AT: -10 }, at: '2026-08-01' },
      { scores: { EI: 10, SN: -10, TF: -10, JP: -10, AT: -10 }, at: '2026-09-01' },
      { scores: { EI: -10, SN: -10, TF: -10, JP: -10, AT: -10 }, at: '2026-10-01' },
    ];
    for (const [i, fixture] of fixtures.entries())
      await saveMbtiPersonalResult(prisma, {
        ...subject,
        completionKey: `mbti-e2e-${i}`,
        resultType: computeMbtiType(fixture.scores),
        resultIdentity: computeMbtiIdentity(fixture.scores),
        ...createMbtiScoreSnapshot(fixture.scores),
        source: 'web',
        completedAt: new Date(fixture.at),
      });
    oldestId = (
      await prisma.mbtiPersonalResult.findUniqueOrThrow({ where: { completionKey: 'mbti-e2e-0' } })
    ).id;
    const other = await prisma.mbtiPersonalResult.create({
      data: {
        ...subject,
        discordUserId: 'other-e2e-user',
        completionKey: 'mbti-e2e-other',
        resultType: 'ISTJ',
        resultIdentity: 'A',
        ...createMbtiScoreSnapshot({ EI: -10, SN: 10, TF: 10, JP: 10, AT: 10 }),
        source: 'web',
        completedAt: new Date(),
      },
    });
    otherId = other.id;
    const { token } = await issueMbtiResultAccess(prisma, subject.guildId, subject.discordUserId);
    path = `/mbti/history/${token}`;
  });
  test.afterAll(async () => {
    if (!enabled) return;
    await prisma.mbtiPersonalResult.deleteMany({ where: { guildId: subject.guildId } });
    await prisma.mbtiResultAccess.deleteMany({ where: { guildId: subject.guildId } });
    await prisma.$disconnect();
  });
  test('desktop comparison selection, historical report, score-only sharing and headers', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(path);
    expect(response?.headers()['cache-control']).toContain('no-store');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page.getByRole('heading', { name: 'わたしの診断ノート' })).toBeVisible();
    await expect(page.locator('.mbti-history-insight')).toContainText('ENFP-T → INFP-T');
    await expect(page.locator('.mbti-report-type')).toHaveText('INFP-T');
    await expect(page.locator('.mbti-history-track').first()).toHaveAttribute(
      'style',
      /--current:69%;--previous:31%/,
    );
    await page.getByLabel('比較する診断').selectOption(oldestId);
    await page.getByRole('button', { name: '比較する', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`compare=${oldestId}`));
    await expect(page.locator('.mbti-history-insight')).toContainText('INTJ-T → INFP-T');
    await page.locator('.mbti-history-list a').filter({ hasText: 'INTJ-T' }).click();
    await expect(page.locator('.mbti-report-type')).toHaveText('INTJ-T');
    await page.getByRole('button', { name: '共有リンクをコピー' }).click();
    const shared = new URL(await page.getByRole('textbox', { name: '共有リンク' }).inputValue());
    expect(shared.pathname).toBe('/mbti/result');
    expect(shared.search).not.toContain('token');
    expect([...shared.searchParams.keys()]).toEqual(['v', 'ei', 'sn', 'tf', 'jp', 'at']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    await page.goto(path);
    await expect(page.locator('.mbti-history-insight')).toBeVisible();
    await page
      .locator('.mbti-history-card')
      .nth(1)
      .screenshot({ path: `${process.env.TEMP}/mbti-history-comparison.png` });
    await page.screenshot({
      path: `${process.env.TEMP}/mbti-history-desktop.png`,
      fullPage: false,
    });
  });
  test('mobile history comparison renders without overflow', async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'あの頃と比べてみる' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
    await page.screenshot({ path: `${process.env.TEMP}/mbti-history-mobile.png`, fullPage: false });
  });
  test('another user result cannot be selected and expired links expose no history', async ({
    page,
  }) => {
    await page.goto(`${path}?result=${otherId}`);
    await expect(page.getByRole('heading', { name: '診断結果が見つかりません' })).toBeVisible();
    await expect(page.locator('.mbti-history-list')).toHaveCount(0);
    await prisma.mbtiResultAccess.updateMany({ where: subject, data: { expiresAt: new Date(0) } });
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'リンクの有効期限が切れたか、無効になっています' }),
    ).toBeVisible();
    await expect(page.locator('.mbti-history-list')).toHaveCount(0);
  });
});
