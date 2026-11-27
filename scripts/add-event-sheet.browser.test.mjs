import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

test('an upward touch swipe reveals the Add Event submit button in mobile landscape', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 568, height: 320 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'member', email: 'member@example.test', firstName: null, lastName: null } } }));
    await page.route('**/api/groups', route => route.fulfill({ json: { groups: [{ id: 'family', name: '家族', color: null }] } }));
    await page.route('**/api/calendar?*', route => route.fulfill({ json: { events: [] } }));
    await page.goto(`${process.env.APP_URL ?? 'http://localhost:5173'}/?date=2026-11-21`);
    await page.getByRole('button', { name: '予定を追加', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: /予定を追加/ });
    const submit = sheet.getByRole('button', { name: '追加する' });
    await page.evaluate(() => document.fonts.ready);
    const readLayout = () => sheet.evaluate(dialog => {
      const { top, bottom } = dialog.getBoundingClientRect();
      return { top, bottom, viewportHeight: innerHeight, scrollTop: dialog.scrollTop };
    });
    const before = await readLayout();

    const cdp = await context.newCDPSession(page);
    const point = y => [{ x: 44, y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(240) });
    for (let y = 220; y >= 100; y -= 20) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(y) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    assert.ok(before.top >= 0 && before.bottom <= before.viewportHeight, `sheet exceeds viewport: ${JSON.stringify(before)}`);
    const after = await readLayout();
    assert.ok(after.scrollTop > before.scrollTop, `touch must scroll the sheet: ${JSON.stringify({ before, after })}`);
    const action = await submit.evaluate(button => {
      const { top, bottom, width, left, height } = button.getBoundingClientRect();
      const x = left + width / 2;
      const y = top + height / 2;
      return { top, bottom, x, y, hit: button.contains(document.elementFromPoint(x, y)) };
    });
    assert.ok(action.top >= 0 && action.bottom <= after.viewportHeight && action.hit, `submit is not reachable: ${JSON.stringify(action)}`);
    await page.touchscreen.tap(action.x, action.y);
    await sheet.getByText('タイトルを入力してください', { exact: true }).waitFor({ timeout: 3000 });
  } finally {
    await context.close();
    await browser.close();
  }
});
