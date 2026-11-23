import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
const sessionUrl = new URL('/api/guest/session', appUrl).href;
const inviteUrl = new URL('/api/invite', appUrl).href;
const answerUrl = new URL('/api/invite/answer', appUrl).href;
const guestCookie = 'sorouyo_guest';
const localD1 = (sql) => execFileSync('node', [
  'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'sorouyo', '--local', '--command', sql,
], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
const guestValue = async (context) => (await context.cookies(appUrl)).find(cookie => cookie.name === guestCookie)?.value;
const cookieValue = (headers) => headers.find(header => header.startsWith(`${guestCookie}=`))?.split(';')[0].slice(guestCookie.length + 1);

test('guest answer survives reopening the invite after any eager session response', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async (t) => {
  const id = randomUUID();
  const token = randomUUID();
  const hash = createHash('sha256').update(token).digest('hex');
  const link = new URL(`/r#${token}`, appUrl).href;
  const name = 'テスト回答者';
  const comment = '当日は参加できます';
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  try {
    localD1(`
      INSERT INTO groups (id, name, created_at) VALUES ('${id}', 'テストグループ', CURRENT_TIMESTAMP);
      INSERT INTO polls (id, group_id, creator_id, title, created_at)
        VALUES ('${id}', '${id}', '${id}', 'ゲスト回答テスト', CURRENT_TIMESTAMP);
      INSERT INTO candidates (id, poll_id, position, date, start_time) VALUES ('${id}', '${id}', 0, '2026-12-01', '13:00');
      INSERT INTO invites (id, purpose, poll_id, token_hash, created_at)
        VALUES ('${id}', 'answer', '${id}', '${hash}', CURRENT_TIMESTAMP);
    `);
    const context = await browser.newContext({ viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const { promise: hold, resolve: release } = Promise.withResolvers();
    const sessions = [];
    try {
      await context.route(sessionUrl, route => {
        // Fetch outside Chrome so a held Set-Cookie cannot enter the browser jar early.
        const upstream = async () => fetch(sessionUrl, { method: 'POST', headers: await route.request().allHeaders() });
        const response = upstream();
        const delivered = Promise.all([response, hold]).then(([res]) =>
          route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers) }));
        sessions.push({ response, delivered });
        return delivered;
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.goto(link);
      const vote = page.getByRole('radio', { name: /参加/ });
      await vote.tap();
      await page.getByLabel('お名前').fill(name);
      await page.getByLabel('ひとこと（任意）').fill(comment);
      const heldCookies = [];
      for (const session of sessions) {
        const response = await session.response;
        assert.equal(response.status, 204);
        const cookie = cookieValue(response.headers.getSetCookie());
        assert.ok(cookie, 'held session response must try to set a cookie');
        heldCookies.push(cookie);
      }
      assert.equal(await guestValue(context), undefined, 'fresh browser has no guest cookie at submit time');
      const [submit] = await Promise.all([
        page.waitForResponse(answerUrl),
        page.getByRole('button', { name: '回答を送る' }).tap(),
      ]);
      assert.equal(submit.status(), 200);
      await page.getByRole('heading', { name: '回答を送りました' }).waitFor();
      const submittedCookie = cookieValue(await submit.headerValues('set-cookie'));
      assert.ok(submittedCookie);
      assert.equal(await guestValue(context) === submittedCookie, true, 'browser accepted the submit cookie');
      const control = await context.request.post(inviteUrl, { data: { token } });
      assert.equal(control.status(), 200);
      assert.equal((await control.json()).poll.ownAnswer?.name, name, 'submit cookie can read the answer before release');

      release();
      await Promise.all(sessions.map(session => session.delivered));
      assert.ok(heldCookies.every(cookie => cookie !== submittedCookie), 'held session cookies differ from the submit cookie');

      const reopened = await context.newPage();
      reopened.setDefaultTimeout(10_000);
      const reopenedResponse = reopened.waitForResponse(inviteUrl);
      await reopened.goto(link);
      const invite = await reopenedResponse;
      assert.equal(invite.status(), 200);
      const ownAnswer = (await invite.json()).poll.ownAnswer;
      const requestCookie = await invite.request().headerValue('cookie');
      const sentCookie = requestCookie?.split('; ').find(pair => pair.startsWith(`${guestCookie}=`))?.slice(guestCookie.length + 1);
      t.diagnostic('submit: 200, answer readable with cookie A');
      if (heldCookies.length) t.diagnostic(`released ${heldCookies.length} session 204 response(s), each setting a cookie different from A`);
      t.diagnostic(`reopen: invite sent ${sentCookie === submittedCookie ? 'cookie A' : heldCookies.includes(sentCookie) ? 'a held session cookie (not A)' : 'an unexpected cookie or no cookie'}, ownAnswer=${ownAnswer ? 'present' : 'null'}`);
      const reopenedName = reopened.getByLabel('お名前');
      await reopenedName.waitFor();
      if (process.env.GUEST_COOKIE_SCREENSHOT) {
        await reopened.evaluate(() => document.fonts.ready);
        await reopened.screenshot({ path: process.env.GUEST_COOKIE_SCREENSHOT, fullPage: true });
      }
      assert.equal(await reopenedName.inputValue(), name, 'reopening the invite must show the saved guest name');
      assert.equal(await reopened.getByLabel('ひとこと（任意）').inputValue(), comment);
      assert.equal(await reopened.getByRole('radio', { name: /参加/ }).getAttribute('aria-checked'), 'true');
      assert.equal(sessions.length, 0, 'opening an invite must not bootstrap a guest session');
    } finally {
      release();
      await context.close();
    }
  } finally {
    await browser.close();
    localD1(`
      DELETE FROM votes WHERE answer_id IN (SELECT id FROM answers WHERE poll_id = '${id}');
      DELETE FROM answers WHERE poll_id = '${id}';
      DELETE FROM candidates WHERE poll_id = '${id}';
      DELETE FROM invites WHERE id = '${id}';
      DELETE FROM polls WHERE id = '${id}';
      DELETE FROM groups WHERE id = '${id}';
    `);
  }
});
