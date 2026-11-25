import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

test('mobile calendar event opens with Tab and Enter or a tap', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 320, height: 600 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    const user = { id: 'test-user', email: 'member@example.test', firstName: null, lastName: null };
    const group = { id: 'test-group', name: '友だち', color: '#4E8A5A' };
    const event = { id: 'test-event', date: '2026-11-21', startTime: '13:00', title: 'ランチ会', group, sourcePollId: null };
    const eventPath = `/events/${event.id}`;
    await page.route(`${origin}/api/auth/me`, route => route.fulfill({ json: { user } }));
    await page.route(`${origin}/api/groups`, route => route.fulfill({ json: { groups: [{ ...group, role: 'member' }] } }));
    await page.route(`${origin}/api/calendar?month=*`, route => {
      const month = new URL(route.request().url()).searchParams.get('month');
      return route.fulfill({ json: { events: month === event.date.slice(0, 7) ? [event] : [] } });
    });
    await page.route(`${origin}/api${eventPath}`, route => route.fulfill({ json: { event } }));

    const dayUrl = `${origin}/?date=${event.date}`;
    const dayPanel = page.locator('.day-panel');
    const eventTitle = dayPanel.getByText(event.title, { exact: true });
    const expectEventDetail = async () => {
      await page.waitForURL(`${origin}${eventPath}`);
      await page.getByRole('heading', { name: event.title, level: 1, exact: true }).waitFor();
    };

    await page.goto(dayUrl);
    await eventTitle.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await dayPanel.getByRole('button', { name: '予定を追加' }).focus();
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      const outlineWidth = parseFloat(style.outlineWidth);
      return {
        href: element.getAttribute('href'),
        outlineWidth,
        ringBottom: element.getBoundingClientRect().bottom + outlineWidth + parseFloat(style.outlineOffset),
        navTop: document.querySelector('.bottom-nav').getBoundingClientRect().top,
      };
    });
    assert.equal(focus.href, eventPath, 'Tab after 予定を追加 must focus the day event link');
    assert.ok(focus.outlineWidth > 0 && focus.ringBottom <= focus.navTop,
      `the focus ring must be visible above the bottom nav: ${JSON.stringify(focus)}`);
    await page.keyboard.press('Enter');
    await expectEventDetail();

    await page.goto(dayUrl);
    await eventTitle.tap();
    await expectEventDetail();
  } finally {
    await context.close();
    await browser.close();
  }
});
