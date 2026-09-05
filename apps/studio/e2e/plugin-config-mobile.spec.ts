import { expect, test } from '@playwright/test';

test('last Discord Role picker stays interactive outside the Config Studio card on mobile', async ({
  page,
}, testInfo) => {
  await page.route('**/api/guilds/123456789012345678/plugins/herta-ai-e2e', async (route) => {
    const payload = route.request().postDataJSON() as {
      enabled?: boolean;
      config?: Record<string, unknown>;
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: payload.enabled ?? true,
        config: payload.config ?? {},
      }),
    });
  });

  await page.goto('/e2e-test/plugin-config-mobile');
  await expect(page.getByRole('heading', { name: 'Plugin設定' })).toBeVisible();

  const roleInput = page.getByRole('combobox', { name: 'AI Roleを選択' });
  await roleInput.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await roleInput.focus();
  await expect(roleInput).toHaveAttribute('aria-expanded', 'true');

  const roleOption = page.getByRole('button', { name: /Herta AI Tester/ });
  await expect(roleOption).toBeVisible();

  const dropdown = roleOption.locator('xpath=..');
  const configSection = page
    .getByRole('heading', { name: 'Plugin設定' })
    .locator('xpath=ancestor::section');
  const footer = page
    .getByRole('button', { name: '変更なし' })
    .locator('xpath=ancestor::div[contains(@class,"sticky")][1]');

  const footerPosition = await footer.evaluate((element) => getComputedStyle(element).position);
  expect(footerPosition).toBe('static');

  const dropdownBox = await dropdown.boundingBox();
  const sectionBox = await configSection.boundingBox();
  expect(dropdownBox).not.toBeNull();
  expect(sectionBox).not.toBeNull();
  if (!dropdownBox || !sectionBox) throw new Error('Expected picker and Config Studio bounds');

  const dropdownBottom = dropdownBox.y + dropdownBox.height;
  const sectionBottom = sectionBox.y + sectionBox.height;
  expect(dropdownBottom).toBeGreaterThan(sectionBottom + 1);

  const probeX = dropdownBox.x + dropdownBox.width / 2;
  const probeY = sectionBottom + Math.min(12, (dropdownBottom - sectionBottom) / 2);
  const hitTestVisible = await dropdown.evaluate(
    (element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit !== null && element.contains(hit);
    },
    { x: probeX, y: probeY },
  );
  expect(hitTestVisible).toBe(true);

  await page.screenshot({
    path: testInfo.outputPath('mobile-role-picker-open.png'),
    fullPage: false,
  });

  await roleOption.click();
  await expect(roleInput).toHaveAttribute('aria-expanded', 'false');
  await expect(roleInput).toHaveAttribute('placeholder', 'Herta AI Tester');

  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByText('保存しました')).toBeVisible();
});
