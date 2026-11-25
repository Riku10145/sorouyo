import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

// CDP接続できるChromeとdevサーバが前提。`npm run test:browser` で opt-in して実行する
// （`node --test scripts/` のような一括実行ではスキップされる）
test('unanswered poll action clears the sticky bar and the guest answer can be edited with keyboard focus', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await page.goto(`${process.env.APP_URL ?? 'http://localhost:5173'}/polls/sample`);
    await page.evaluate(() => document.fonts.ready);
    const answer = page.getByRole('button', { name: '回答する', exact: true });
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

    const candidates = page.getByRole('heading', { name: '候補日' });
    await candidates.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'opening the invitation must not move focus');

    const rows = page.getByRole('radiogroup');
    const votes = [/参加$/, /未定$/, /欠席$/];
    const name = page.getByRole('textbox', { name: 'お名前' });
    for (const [index, vote] of votes.entries()) {
      await rows.nth(index).getByRole('radio', { name: vote }).click();
    }
    await name.fill('はな');
    await page.getByRole('button', { name: '回答を送る' }).press('Enter');

    const receipt = page.getByRole('heading', { name: '回答を送りました' });
    await receipt.waitFor();
    assert.equal(await receipt.evaluate(heading => heading === document.activeElement), true, 'sending must focus the receipt heading');

    await page.getByRole('button', { name: '回答を変更する' }).press('Enter');
    await candidates.waitFor();
    assert.equal(await name.inputValue(), 'はな');
    for (const [index, vote] of votes.entries()) {
      assert.equal(await rows.nth(index).getByRole('radio', { name: vote }).getAttribute('aria-checked'), 'true');
    }
    const focused = await candidates.evaluate(heading => heading === document.activeElement ? heading.textContent : document.activeElement.tagName);
    assert.equal(focused, '候補日', 'editing must focus the candidate heading');
  } finally {
    await context.close();
    await browser.close();
  }
});
