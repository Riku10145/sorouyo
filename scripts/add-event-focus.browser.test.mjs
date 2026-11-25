import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

test('Add Event sheet keyboard focus and dismissal', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async t => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const mobile = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

  async function openSheet(options, open, check) {
    const context = await browser.newContext(options);
    try {
      const page = await context.newPage();
      await page.route('**/api/auth/me', route => route.fulfill({
        json: { user: { id: 'user-1', email: 'user@example.test', firstName: null, lastName: null } },
      }));
      await page.route('**/api/groups', route => route.fulfill({
        json: { groups: [{ id: 'group-1', name: 'テストグループ', color: null }] },
      }));
      await page.route('**/api/calendar?*', route => route.fulfill({ json: { events: [] } }));
      await page.goto(new URL('/?date=2026-11-21', process.env.APP_URL ?? 'http://localhost:5173').href);

      const trigger = page.getByRole('button', { name: '予定を追加', exact: true });
      const sheet = page.getByRole('dialog', { name: /の予定を追加$/ });
      await open(trigger);
      await sheet.waitFor();
      const title = sheet.getByRole('textbox', { name: 'タイトル' });
      await assertFocus(title, 'opening the sheet must autofocus the title');
      await check({ page, trigger, sheet, title });
    } finally {
      await context.close();
    }
  }

  async function assertFocus(locator, message) {
    assert.equal(await locator.evaluate(node => node === document.activeElement ? 'focused'
      : document.activeElement?.outerHTML.slice(0, 160)), 'focused', message);
  }

  async function assertDismissed(sheet, trigger, action) {
    assert.equal(await sheet.count(), 0, `${action} must close the sheet`);
    await assertFocus(trigger, `${action} must restore focus to the trigger`);
  }

  const desktop = { viewport: { width: 1440, height: 900 } };
  const openByKeyboard = trigger => trigger.press('Enter');

  try {
    await t.test('Shift+Tab wraps from title to submit', () => openSheet(desktop, openByKeyboard, async ({ page, sheet }) => {
      await page.keyboard.press('Shift+Tab');
      await assertFocus(sheet.getByRole('button', { name: '追加する' }), 'Shift+Tab from the title must reach the last control');
    }));

    await t.test('Tab wraps from submit to title', () => openSheet(desktop, openByKeyboard, async ({ page, sheet, title }) => {
      await sheet.getByRole('button', { name: '追加する' }).focus();
      await page.keyboard.press('Tab');
      await assertFocus(title, 'Tab from the last control must return to the title');
    }));

    await t.test('Escape closes the sheet and restores focus', () => openSheet(desktop, openByKeyboard, async ({ page, sheet, trigger }) => {
      await page.keyboard.press('Escape');
      await assertDismissed(sheet, trigger, 'Escape');
    }));

    await t.test('tapping cancel closes the sheet and restores focus', () => openSheet(mobile, trigger => trigger.tap(), async ({ sheet, trigger }) => {
      await sheet.getByRole('button', { name: 'キャンセル' }).tap();
      await assertDismissed(sheet, trigger, 'Cancel');
    }));

    await t.test('tapping the backdrop closes the sheet and restores focus', () => openSheet(mobile, trigger => trigger.tap(), async ({ page, sheet, trigger }) => {
      await page.locator('.sheet-backdrop').tap({ position: { x: 10, y: 10 } });
      await assertDismissed(sheet, trigger, 'Backdrop tap');
    }));
  } finally {
    await browser.close();
  }
});
