import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

const skip = process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）';
const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

test('group creation limit explains how to free capacity without clearing the entered name or color', { skip }, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const groups = Array.from({ length: 5 }, (_, index) => ({
      id: `group-${index}`, name: `グループ${index}`, color: '#D97A3D', role: 'admin',
    }));
    const posts = [];
    await page.route('**/api/auth/me', route => route.fulfill({
      json: { user: { id: 'user-host', email: 'host@example.com', firstName: '一郎', lastName: '主催' } },
    }));
    await page.route('**/api/groups', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { groups } });
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { error: 'group_limit' } });
    });

    await page.goto(`${appUrl}/groups`);
    await page.getByRole('button', { name: 'グループを作成' }).click();
    await page.getByLabel('グループ名').fill('上限後のグループ');
    await page.getByRole('radio', { name: '色 #4E8A5A' }).click();
    await page.getByRole('button', { name: '作成する' }).click();

    await page.getByRole('alert').filter({ hasText: '作成できるグループは5件までです。' }).waitFor();
    await page.getByText('一覧から不要なグループを開き、作成済みが4件以下になるまで削除すると、また作成できます。').waitFor();
    assert.equal(await page.getByLabel('グループ名').inputValue(), '上限後のグループ');
    assert.equal(await page.getByRole('radio', { name: '色 #4E8A5A' }).getAttribute('aria-checked'), 'true');
    assert.deepEqual(posts, [{ name: '上限後のグループ', color: '#4E8A5A' }]);
  } finally {
    await context.close();
    await browser.close();
  }
});
