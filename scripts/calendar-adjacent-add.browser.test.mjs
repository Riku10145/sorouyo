import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

test('adding an event on an adjacent-month day refreshes that month', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    const group = { id: 'friends', name: 'いつメン', color: '#4E8A5A', role: 'member' };
    const events = [];
    await page.route(`${origin}/api/auth/me`, route => route.fulfill({
      json: { user: { id: 'member', email: 'member@example.test', firstName: null, lastName: null } },
    }));
    await page.route(`${origin}/api/groups`, route => route.fulfill({ json: { groups: [group] } }));
    await page.route(`${origin}/api/calendar?month=*`, route => {
      const month = new URL(route.request().url()).searchParams.get('month');
      return route.fulfill({ json: { events: events.filter(event => event.date.startsWith(month)) } });
    });
    await page.route(`${origin}/api/groups/friends/events`, async route => {
      const body = await route.request().postDataJSON();
      const event = {
        id: 'created-event', date: body.date, startTime: body.time ?? null, title: body.title,
        group: { id: group.id, name: group.name, color: group.color }, sourcePollId: null,
      };
      events.push(event);
      return route.fulfill({ json: { event } });
    });

    await page.goto(`${origin}/?date=2026-11-01`);
    await page.locator('[data-date="2026-12-01"]').tap();
    await page.locator('.day-panel').getByRole('button', { name: '予定を追加' }).tap();
    await page.getByLabel('タイトル').fill('隣月の打ち合わせ');
    await page.getByRole('button', { name: '追加する' }).tap();
    await page.locator('.day-panel').getByText('隣月の打ち合わせ').waitFor();
    assert.equal(await page.getByRole('grid', { name: '2026年11月のカレンダー' }).count(), 1,
      'adding from an adjacent-month cell must not change the viewed month');
  } finally {
    await context.close();
    await browser.close();
  }
});
