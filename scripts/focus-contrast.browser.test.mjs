import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

function luminance(rgb) {
  const channels = rgb.match(/\d+/g).slice(0, 3).map(Number).map(value => value / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

async function assertOutline(target, surface, offset) {
  const ring = await target.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.outlineColor, alpha: style.opacity, style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset };
  });
  const background = await surface.evaluate(element => getComputedStyle(element).backgroundColor);
  assert.equal(ring.style, 'solid');
  assert.equal(ring.width, '3px');
  assert.equal(ring.offset, offset);
  assert.equal(ring.alpha, '1', 'focus outline must not inherit the dimmed appearance');
  const values = [luminance(ring.color), luminance(background)];
  const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
  assert.ok(ratio >= 3, `focus outline ${ring.color} on ${background}: ${ratio.toFixed(2)}:1`);
}

async function tabTo(page, target) {
  await target.waitFor();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement && element.matches(':focus-visible'))) return;
  }
  assert.fail(`Keyboard focus did not reach ${target}`);
}

test('keyboard focus has 3:1 contrast, including an unchecked sidebar group', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const url = process.env.APP_URL ?? 'http://localhost:5173';
  try {
    for (const isMobile of [true, false]) {
      const context = await browser.newContext({
        viewport: isMobile ? { width: 375, height: 667 } : { width: 1200, height: 800 },
        isMobile, hasTouch: isMobile,
      });
      try {
        const page = await context.newPage();
        await page.goto(`${url}/r#sample`);
        const vote = page.locator('.vote-btn').first();
        await tabTo(page, vote);
        await assertOutline(vote, page.locator(isMobile ? '.guest' : '.guest-split'), '2px');

        if (!isMobile) {
          await page.goto(`${url}/?date=2026-11-21`);
          const group = page.locator('.side-groups label').first();
          const input = group.locator('input');
          await tabTo(page, input);
          await assertOutline(group, page.locator('.sidebar'), '0px');
          await page.keyboard.press('Space');
          assert.equal(await input.isChecked(), false);
          assert.ok(await input.evaluate(element => element.matches(':focus-visible')));
          const nameOpacity = await group.locator('.side-group-name').evaluate(element => getComputedStyle(element).opacity);
          assert.equal(nameOpacity, '0.45');
          await assertOutline(group, page.locator('.sidebar'), '0px');
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
