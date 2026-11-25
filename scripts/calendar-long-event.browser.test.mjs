import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

test('mobile month tap scrolls to full wrapping event titles with their groups', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    const group = { id: 'friends', name: 'いつメン', color: '#4E8A5A', role: 'member' };
    const titles = [
      'とても長いタイトルの映画鑑賞会とお好み焼きパーティー',
      'とても長いタイトルの映画鑑賞会と深夜ボードゲーム大会',
    ];
    const events = titles.map((title, index) => ({
      id: `event-${index}`,
      date: '2026-11-21',
      startTime: index === 0 ? '19:00' : '21:00',
      title,
      group: { id: group.id, name: group.name, color: group.color },
      sourcePollId: null,
    }));
    await page.route(`${origin}/api/auth/me`, route => route.fulfill({
      json: { user: { id: 'member', email: 'member@example.test', firstName: null, lastName: null } },
    }));
    await page.route(`${origin}/api/groups`, route => route.fulfill({ json: { groups: [group] } }));
    await page.route(`${origin}/api/calendar?month=*`, route => {
      const month = new URL(route.request().url()).searchParams.get('month');
      return route.fulfill({ json: { events: month === '2026-11' ? events : [] } });
    });

    await page.goto(`${origin}/?date=2026-11-01`);
    await page.locator('.day-panel').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => window.scrollY);
    await page.locator('[data-date="2026-11-21"]').tap();
    await page.waitForFunction(y => window.scrollY > y + 80, before);

    assert.equal(await page.getByRole('grid', { name: '2026年11月のカレンダー' }).count(), 1, ' tapping a date must keep the viewed month');
    const items = page.locator('.day-panel .day-item');
    assert.equal(await items.count(), 2);
    for (const [index, title] of titles.entries()) {
      assert.equal((await items.nth(index).locator('strong').textContent())?.trim(), title);
      assert.equal((await items.nth(index).locator('.day-text span').textContent())?.trim(), group.name);
    }
    const geometry = await page.evaluate(() => [...document.querySelectorAll('.day-panel .day-item')].map(item => {
      const rect = item.getBoundingClientRect();
      const title = item.querySelector('strong').getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, titleRight: title.right, itemRight: rect.right, titleHeight: title.height };
    }));
    assert.ok(geometry[0].titleHeight > 24, `the long title must wrap instead of truncating: ${JSON.stringify(geometry)}`);
    assert.ok(geometry[0].bottom <= geometry[1].top + 1, `events must not overlap: ${JSON.stringify(geometry)}`);
    for (const item of geometry) assert.ok(item.titleRight <= item.itemRight + 1, `title must stay inside its row: ${JSON.stringify(geometry)}`);

    await page.locator('[data-date="2026-12-01"]').tap();
    await page.locator('.day-panel').getByText('12月1日', { exact: false }).waitFor();
    assert.equal(await page.getByRole('grid', { name: '2026年11月のカレンダー' }).count(), 1, 'tapping an adjacent-month cell must keep the viewed month');
  } finally {
    await context.close();
    await browser.close();
  }
});
