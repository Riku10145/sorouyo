import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

const skip = process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）';
const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

const hostUser = { id: 'user-host', email: 'host@example.test', firstName: '一郎', lastName: '主催' };
const memberUser = { id: 'user-member', email: 'member@example.test', firstName: '花子', lastName: null };

async function connect() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  return { browser, context };
}

function detailFor(user) {
  return {
    group: { id: 'group-1', name: 'いつメン', color: '#4E8A5A', role: user.id === 'user-host' ? 'admin' : 'member' },
    creatorId: 'user-host',
    members: [
      { id: 'user-host', name: '主催 一郎', role: 'admin', you: user.id === 'user-host' },
      { id: 'user-member', name: '花子', role: 'member', you: user.id === 'user-member' },
    ],
    counts: { events: 1, polls: 1, members: 2 },
    joinInvite: { id: 'invite-1', createdAt: '2026-11-26T00:00:00.000Z', expiresAt: '2026-12-03T00:00:00.000Z', state: 'active' },
  };
}

test('creator removes a member after confirmation and the invite renewal guidance appears', { skip }, async () => {
  const { browser, context } = await connect();
  try {
    const page = await context.newPage();
    let removed = false;
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: hostUser } }));
    await page.route('**/api/groups/group-1/members/user-member', route => {
      removed = route.request().method() === 'DELETE';
      return route.fulfill({ status: 204 });
    });
    await page.route('**/api/groups/group-1', route => route.fulfill({ json: detailFor(hostUser) }));

    await page.goto(`${appUrl}/groups/group-1`);
    await page.getByRole('button', { name: '除名', exact: true }).tap();
    const confirmation = page.getByRole('alertdialog', { name: '除名の確認' });
    await confirmation.getByText('この人が入れた予定や回答は残ります。').waitFor();
    await confirmation.getByRole('button', { name: '除名する' }).tap();

    await page.getByText('除名にあわせて参加リンクを無効化しました。引き続き使う場合は再発行してください。').waitFor();
    assert.equal(removed, true);
    assert.equal(await page.getByText('花子', { exact: true }).count(), 0);
    await page.getByText('1人のメンバー ・ 予定1件 ・ 日程調整1件').waitFor();
    await page.getByText('現在のリンク: 無効化済み').waitFor();
    assert.equal(await page.getByRole('button', { name: '脱退', exact: true }).count(), 0);
  } finally {
    await context.close();
    await browser.close();
  }
});

test('member leaves after confirmation and returns to the group list', { skip }, async () => {
  const { browser, context } = await connect();
  try {
    const page = await context.newPage();
    let left = false;
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: memberUser } }));
    await page.route('**/api/groups/group-1/members/user-member', route => {
      left = route.request().method() === 'DELETE';
      return route.fulfill({ status: 204 });
    });
    await page.route('**/api/groups/group-1', route => route.fulfill({ json: detailFor(memberUser) }));
    await page.route('**/api/groups', route => route.fulfill({ json: { groups: [] } }));

    await page.goto(`${appUrl}/groups/group-1`);
    assert.equal(await page.getByRole('button', { name: '除名', exact: true }).count(), 0);
    await page.getByRole('button', { name: '脱退', exact: true }).tap();
    const confirmation = page.getByRole('alertdialog', { name: '脱退の確認' });
    await confirmation.getByText('グループの予定や日程調整は見られなくなります。').waitFor();
    await confirmation.getByRole('button', { name: '脱退する' }).tap();

    await page.waitForURL(/\/groups\/?$/);
    assert.equal(left, true);
  } finally {
    await context.close();
    await browser.close();
  }
});
