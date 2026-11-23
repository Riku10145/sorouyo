import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

// CDP接続できるChromeとdevサーバが前提。`npm run test:browser` で opt-in して実行する
// （`node --test scripts/` のような一括実行ではスキップされる）
test('keyboard focus scrolls the add-event action clear of the bottom nav', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 320, height: 600 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await page.goto(`${process.env.APP_URL ?? 'http://localhost:5173'}/?date=2026-11-21`);
    await page.evaluate(() => document.fonts.ready);
    const add = page.getByRole('button', { name: '予定を追加', exact: true });
    await page.locator('.cal-cell[aria-selected="true"]').focus();
    for (let i = 0; i < 10 && !(await add.evaluate(element => element === document.activeElement)); i++) await page.keyboard.press('Tab');
    const geometry = await add.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        focused: element === document.activeElement,
        ringBottom: rect.bottom + parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset), navTop: nav.top, scrollY,
        hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      };
    });
    assert.ok(geometry.focused, `Tab must reach 予定を追加: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.ringBottom <= geometry.navTop, `focused action and its focus ring must sit above the bottom nav: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.hit, 'focused action must not be covered');
  } finally {
    await context.close();
    await browser.close();
  }
});
