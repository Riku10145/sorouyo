import assert from 'node:assert/strict';
import test from 'node:test';

test('desktop sidebar keeps settings reachable in a short viewport', {
  skip: process.env.SIDEBAR_SCROLL_TEST !== '1',
}, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 1280, height: 420 } });
  try {
    const page = await context.newPage();
    await page.goto(process.env.APP_URL ?? 'http://localhost:5173');
    await page.locator('.side-settings').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const result = await page.locator('.sidebar').evaluate(sidebar => {
      const overflowY = getComputedStyle(sidebar).overflowY;
      sidebar.scrollTop = sidebar.scrollHeight;
      const settings = sidebar.querySelector('.side-settings').getBoundingClientRect();
      return {
        overflowY,
        scrollTop: sidebar.scrollTop,
        overflows: sidebar.scrollHeight > sidebar.clientHeight,
        settingsVisible: settings.top >= 0 && settings.bottom <= innerHeight,
      };
    });
    assert.ok(result.overflows, `short sidebar should overflow: ${JSON.stringify(result)}`);
    assert.match(result.overflowY, /^(auto|scroll)$/, 'overflowing sidebar must allow user scrolling');
    assert.ok(result.scrollTop > 0, 'sidebar must scroll independently of the main content');
    assert.ok(result.settingsVisible, '設定 must be fully inside the viewport after sidebar scrolling');
  } finally {
    await context.close();
    await browser.close();
  }
});
