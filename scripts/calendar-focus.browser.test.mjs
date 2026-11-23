import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

test('desktop calendar restores date focus across months without moving month-button focus', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(new URL('/?date=2026-11-21', process.env.APP_URL ?? 'http://localhost:5173').href);

    const active = () => page.evaluate(() => ({
      focus: document.activeElement?.getAttribute('data-date') ?? document.activeElement?.tagName,
      selected: document.querySelector('[role="gridcell"][aria-selected="true"]')?.getAttribute('data-date'),
    }));

    await page.locator('[data-date="2026-12-01"].outside').click();
    await page.locator('[data-date="2026-12-01"][aria-selected="true"]:not(.outside)').waitFor();
    const afterClick = await active();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await active(), { focus: '2026-12-02', selected: '2026-12-02' },
      `ArrowRight must move from the clicked December cell (after click: ${JSON.stringify(afterClick)})`);
    assert.equal(afterClick.focus, '2026-12-01', 'the replacement December cell must receive focus');

    await page.locator('[data-date="2026-11-30"].outside').click();
    await page.locator('[data-date="2026-11-30"][aria-selected="true"]:not(.outside)').waitFor();
    assert.deepEqual(await active(), { focus: '2026-11-30', selected: '2026-11-30' },
      'the replacement November cell must receive focus');

    for (const [name, month] of [['次の月', 12], ['前の月', 11]]) {
      const button = page.getByRole('button', { name, exact: true });
      await button.click();
      await page.getByRole('grid', { name: `2026年${month}月のカレンダー` }).waitFor();
      assert.equal(await button.evaluate(node => node === document.activeElement), true,
        `the ${name} button must keep its focus`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
});
