import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

const skip = process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）';
const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

test('guest answer completion links to first group creation and login preserves the create intent', { skip }, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'unauthenticated' } }));
    await page.goto(`${appUrl}/r#sample`);
    const rows = page.getByRole('radiogroup');
    for (const [index, vote] of [/参加$/, /未定$/, /欠席$/].entries()) {
      await rows.nth(index).getByRole('radio', { name: vote }).click();
    }
    await page.getByLabel('お名前').fill('はな');
    await page.getByRole('button', { name: '回答を送る' }).click();
    await page.getByRole('heading', { name: '回答を送りました' }).waitFor();

    const start = page.getByRole('link', { name: '自分のグループを作る' });
    assert.ok((await start.getAttribute('href'))?.endsWith('/groups?create=1'));
    await start.click();
    await page.waitForURL('**/groups?create=1');
    await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
    const loginHref = await page.getByRole('link', { name: 'ログイン' }).getAttribute('href');
    assert.ok(loginHref?.includes(`next=${encodeURIComponent('/groups?create=1')}`), loginHref ?? 'missing login href');
  } finally {
    await context.close();
    await browser.close();
  }
});

test('signed-in user opening /groups?create=1 lands directly on the group creation form', { skip }, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.route('**/api/auth/me', route => route.fulfill({
      json: { user: { id: 'user-guest-host', email: 'guest-host@example.com', firstName: null, lastName: null } },
    }));
    await page.route('**/api/groups', route => route.fulfill({ json: { groups: [] } }));
    await page.goto(`${appUrl}/groups?create=1`);
    await page.getByRole('heading', { name: 'グループを作成' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '作成する' }).isVisible(), true);
    assert.equal(await page.getByLabel('グループ名').inputValue(), '');
  } finally {
    await context.close();
    await browser.close();
  }
});
