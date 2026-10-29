import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`agent CRUD, zero candidates, deletion dialog and errors at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    let agents = [{ agentId: 'jett', agentName: 'Jett', displayName: 'ジェット', enabled: true }];
    let failure = false;
    await page.route('**/api/guilds/123456789012345678/valorant/agents**', async (route) => {
      const request = route.request();
      if (failure) return route.fulfill({ status: 503, json: { error: '接続エラーです。' } });
      const method = request.method();
      if (method === 'POST') agents.push(request.postDataJSON());
      if (method === 'PATCH')
        agents = agents.map((agent) =>
          agent.agentId === request.postDataJSON().agentId ? request.postDataJSON() : agent,
        );
      if (method === 'DELETE')
        agents = agents.filter((agent) => !request.url().endsWith(`/${agent.agentId}`));
      await route.fulfill({ json: { agents, initialized: true, canWrite: true } });
    });
    await page.goto('/e2e-test/valorant');
    await expect(page.getByText('登録 1件 · 有効 1件')).toBeVisible();
    await page.getByRole('checkbox', { name: 'ジェットを有効にする' }).click();
    await expect(page.getByText('登録 1件 · 有効 0件')).toBeVisible();
    await page.getByRole('textbox', { name: 'Agent ID' }).fill('custom');
    await page.getByRole('textbox', { name: 'Agent Name' }).fill('Custom');
    await page.getByRole('textbox', { name: '表示名' }).fill('カスタム');
    await page.getByRole('button', { name: '新規登録', exact: true }).click();
    await expect(page.getByText('登録 2件 · 有効 1件')).toBeVisible();
    await page.getByRole('button', { name: '編集 カスタム', exact: true }).click();
    await page.getByRole('textbox', { name: '表示名' }).fill('変更済み');
    await page.getByRole('button', { name: '変更を保存' }).click();
    await expect(page.getByRole('button', { name: '削除 変更済み', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '削除 変更済み', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: '削除 変更済み', exact: true }).click();
    await page.getByRole('button', { name: '削除を確定' }).click();
    await expect(page.getByText('登録 1件 · 有効 0件')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`valorant-${width}.png`), fullPage: true });
    failure = true;
    await page.getByRole('checkbox', { name: 'ジェットを有効にする' }).click();
    await expect(page.getByRole('alert')).toContainText('接続エラー');
  });
}
