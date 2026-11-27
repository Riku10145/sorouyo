import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

const skip = process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）';
const token = 'guest-invite-browser-test';
const url = new URL(`/r#${token}`, process.env.APP_URL ?? 'http://localhost:5173').href;
const poll = {
  id: 'test-poll',
  title: '週末の集まり',
  status: 'open',
  accepting: true,
  deadlineAt: null,
  group: { id: 'friends', name: '友だち', color: null },
  host: 'さき',
  candidates: [{ id: 'first', date: '2026-11-28', startTime: '12:00' }],
  confirmed: null,
  ownAnswer: null,
};

async function withInvitePage(respond, check) {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const requests = [];
    await page.route('**/api/guest/session', route => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/invite', route => {
      requests.push({ method: route.request().method(), body: route.request().postDataJSON() });
      return respond(route);
    });
    await page.goto(url);
    await check(page, requests);
  } finally {
    await context.close();
    await browser.close();
  }
}

test('a 404 invite still asks for a new link and does not offer retry', { skip }, async () => {
  await withInvitePage(route => route.fulfill({ status: 404, json: { error: 'invite_invalid' } }), async (page, requests) => {
    const alert = page.getByRole('alert');
    await alert.getByText('招待リンクが無効です。送ってくれた方に、新しいリンクをお願いしてください。').waitFor();
    assert.equal(await page.getByRole('button', { name: 'もう一度試す' }).count(), 0);
    assert.ok(requests.length > 0);
    assert.deepEqual(requests, requests.map(() => ({ method: 'POST', body: { token } })));
  });
});

for (const [failure, respond] of [
  ['503', route => route.fulfill({ status: 503, json: { error: 'unavailable' } })],
  ['network error', route => route.abort('failed')],
]) {
  test(`a ${failure} loading an invite offers retry and recovers on the same URL`, { skip }, async () => {
    let available = false;
    await withInvitePage(route => available ? route.fulfill({ json: { poll } }) : respond(route), async (page, requests) => {
      const invalid = page.getByText('リンクをご確認ください');
      const retry = page.getByRole('button', { name: 'もう一度試す' });
      await page.getByRole('alert').waitFor();
      assert.equal(await invalid.count(), 0, 'a failed load must not say the invite is invalid');
      await page.getByRole('heading', { name: '招待を読み込めませんでした' }).waitFor();
      assert.equal(page.url(), url);
      const initialRequests = requests.length;
      assert.ok(initialRequests > 0);
      available = true;
      await retry.tap();
      await page.getByRole('heading', { name: poll.title }).waitFor();
      await page.getByRole('button', { name: '回答を送る' }).waitFor();
      assert.equal(page.url(), url);
      assert.equal(await retry.count(), 0);
      assert.equal(requests.length, initialRequests + 1);
      assert.deepEqual(requests, requests.map(() => ({ method: 'POST', body: { token } })));
    });
  });
}
