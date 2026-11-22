import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

// CDP接続できるChromeとdevサーバが前提。`npm run test:browser` で opt-in して実行する
// （`node --test scripts/` のような一括実行ではスキップされる）
test('unanswered poll action scrolls clear of the sticky confirmation bar', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await page.goto(`${process.env.APP_URL ?? 'http://localhost:5173'}/polls/sample`);
    await page.evaluate(() => document.fonts.ready);
    const answer = page.getByRole('link', { name: '回答する', exact: true });
    await answer.scrollIntoViewIfNeeded();
    const geometry = await answer.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const bar = document.querySelector('.confirm-bar').getBoundingClientRect();
      return { answerBottom: rect.bottom, barTop: bar.top, hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
    });
    assert.ok(geometry.answerBottom <= geometry.barTop, JSON.stringify(geometry));
    assert.ok(geometry.hit, 'answer action must receive the tap');
    await answer.tap();
    await page.waitForURL('**/r#sample');
    assert.equal(await page.locator('.confirmed').count(), 0);
  } finally {
    await context.close();
    await browser.close();
  }
});
