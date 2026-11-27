import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

for (const [label, selector, viewport, isMobile] of [
  ['mobile day panel', '.day-panel', { width: 390, height: 844 }, true],
  ['desktop sidebar', '.side-day', { width: 1280, height: 900 }, false],
]) {
  test(`${label} shows a calendar load failure and retries the selected month`, {
    skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
  }, async () => {
    const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
    const context = await browser.newContext({ viewport, isMobile });
    const retryResponse = Promise.withResolvers();
    try {
      const page = await context.newPage();
      const date = '2026-11-21';
      const month = date.slice(0, 7);
      const group = { id: 'family', name: '家族', color: null };
      let requests = 0;
      await page.route('**/api/auth/me', route => route.fulfill({
        json: { user: { id: 'member', email: 'member@example.com', firstName: null, lastName: null } },
      }));
      await page.route('**/api/groups', route => route.fulfill({ json: { groups: [group] } }));
      await page.route('**/api/calendar?month=*', async route => {
        if (new URL(route.request().url()).searchParams.get('month') === month) {
          requests += 1;
          if (requests === 1) return route.fulfill({ status: 500, json: { error: 'unavailable' } });
          await retryResponse.promise;
        }
        await route.fulfill({ json: { events: [] } });
      });

      await page.goto(new URL(`/?date=${date}`, process.env.APP_URL ?? 'http://localhost:5173').href);
      const summary = page.locator(selector);
      const error = summary.getByRole('alert');
      const empty = summary.getByText(isMobile ? 'この日の予定はまだありません。' : '予定はありません');
      const count = summary.getByText('0件', { exact: true });
      const retry = summary.getByRole('button', { name: '再試行' });
      await error.or(empty).waitFor();
      assert.equal((await error.or(empty).textContent()),
        '予定を読み込めませんでした。');
      assert.equal(await empty.count(), 0);
      assert.equal(await count.count(), 0);

      await retry.click();
      await summary.getByText('予定を読み込み中…').waitFor();
      assert.equal(await empty.count(), 0);
      assert.equal(await count.count(), 0);
      assert.equal(await retry.count(), 0);
      retryResponse.resolve();
      await empty.waitFor();
      assert.equal(requests, 2, 'Retry must fetch the same selected month once');
      assert.equal(await error.count(), 0);
      if (isMobile) assert.equal(await count.isVisible(), true);
    } finally {
      retryResponse.resolve();
      await context.close();
      await browser.close();
    }
  });
}
