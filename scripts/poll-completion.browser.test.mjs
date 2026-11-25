import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

test('host answer state is explicit and the confirm completion screen does not leak across polls', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    const user = { id: 'host-user', email: 'host@example.test', firstName: '太郎', lastName: '山田' };
    const group = { id: 'friends', name: 'いつメン', color: '#4E8A5A' };
    const candidates = [
      { id: 'cand-1', date: '2026-11-21', startTime: '19:00' },
      { id: 'cand-2', date: '2026-11-22', startTime: '12:00' },
    ];
    const pollA = {
      id: 'poll-a', title: '餃子の会', status: 'open', deadlineAt: null, confirmedCandidateId: null,
      group, creatorId: user.id, hostName: '山田 太郎', candidates,
      answers: [{ id: 'answer-hana', name: 'はな', comment: null, own: false, votes: { 'cand-1': 'yes', 'cand-2': 'no' }, createdAt: '2026-11-01T00:00:00Z' }],
    };
    const pollB = { ...pollA, id: 'poll-b', title: '別の集まり', answers: [] };
    const bodyFor = poll => ({ poll: JSON.parse(JSON.stringify({ ...poll, group })) });
    await page.route(`${origin}/api/auth/me`, route => route.fulfill({ json: { user } }));
    await page.route(`${origin}/api/groups`, route => route.fulfill({ json: { groups: [group] } }));
    await page.route(`${origin}/api/calendar?month=*`, route => route.fulfill({ json: { events: [] } }));
    await page.route(/\/api\/polls\/.*/, async route => {
      const request = route.request();
      const parts = new URL(request.url()).pathname.split('/');
      const id = parts[3];
      const action = parts[4];
      const poll = id === 'poll-a' ? pollA : id === 'poll-b' ? pollB : null;
      if (!poll) return route.fulfill({ status: 404, json: { error: 'not_found' } });
      if (request.method() === 'GET' && !action) return route.fulfill({ json: bodyFor(poll) });
      if (request.method() === 'POST' && action === 'confirm') {
        poll.status = 'confirmed';
        poll.confirmedCandidateId = 'cand-1';
        return route.fulfill({ json: { poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: 'cand-1' }, event: { id: 'event-1' } } });
      }
      return route.fulfill({ status: 500, json: { error: 'unexpected' } });
    });

    await page.goto(`${origin}/polls/poll-a`);
    const ownMark = page.locator('.member-marks li').first();
    await ownMark.waitFor();
    assert.match((await ownMark.textContent()) ?? '', /未回答/);
    assert.match((await ownMark.textContent()) ?? '', /あなた/);
    assert.equal(await page.getByText('あなたはまだ未回答です').count(), 1);
    await page.getByText('2人中1人が回答', { exact: true }).waitFor();

    pollA.answers.push({ id: 'answer-host', name: '山田 太郎', comment: null, own: true, votes: { 'cand-1': 'yes' }, createdAt: '2026-11-01T01:00:00Z' });
    await page.goto(`${origin}/polls/poll-a`);
    await ownMark.waitFor();
    assert.doesNotMatch((await ownMark.textContent()) ?? '', /未回答/, 'an answered host must not remain in the pending state');
    assert.equal(await page.getByText('あなたはまだ未回答です').count(), 0);
    await page.getByText('2人中2人が回答', { exact: true }).waitFor();

    await page.getByRole('button', { name: /に確定する/ }).tap();
    const complete = page.getByRole('heading', { name: '日程が決まりました', level: 1 });
    await complete.waitFor();
    assert.equal(await complete.evaluate(heading => heading === document.activeElement), true, 'the completion heading must receive focus');
    await page.getByText('いつメンのカレンダーに追加しました').waitFor();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.getByRole('heading', { name: '餃子の会', level: 1 }).waitFor();
    assert.equal(await page.locator('.confirm-complete').count(), 0, 'a persisted pageshow must clear the completion screen');

    pollA.status = 'open';
    pollA.confirmedCandidateId = null;
    await page.goto(`${origin}/polls/poll-a`);
    await page.getByRole('button', { name: /に確定する/ }).tap();
    await page.getByRole('heading', { name: '日程が決まりました', level: 1 }).waitFor();
    await page.getByRole('link', { name: 'カレンダーで見る' }).tap();
    await page.getByRole('grid', { name: '2026年11月のカレンダー' }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: '餃子の会', level: 1 }).waitFor();
    assert.equal(await page.locator('.confirm-complete').count(), 0, 'browser back must not restore the transient completion screen');

    await page.goto(`${origin}/polls/poll-b`);
    await page.getByRole('heading', { name: '別の集まり', level: 1 }).waitFor();
    assert.equal(await page.locator('.confirm-complete').count(), 0, 'completion must not appear on another poll');

    await page.goto(`${origin}/polls/poll-a`);
    await page.getByRole('heading', { name: '餃子の会', level: 1 }).waitFor();
    assert.equal(await page.locator('.confirm-complete').count(), 0, 'completion must disappear after leaving it');
    assert.equal(await page.locator('.confirmed').count(), 0, 'the transient confirmation notice must not remain as a banner');
    assert.ok(await page.locator('.chip-soft', { hasText: '確定' }).count() > 0, 'the confirmed candidate keeps its status chip');

    await page.goto(`${origin}/polls/sample`);
    await page.getByRole('button', { name: /に確定する/ }).tap();
    await page.getByRole('heading', { name: '日程が決まりました', level: 1 }).waitFor();
    assert.equal(await page.locator('.calendar-added').count(), 0, 'the sample must not claim that a calendar event was created');
    assert.equal(await page.getByRole('link', { name: 'カレンダーで見る' }).count(), 0, 'the sample must not link to a calendar event that was not created');
  } finally {
    await context.close();
    await browser.close();
  }
});

test('desktop completion sidebar shows the confirmed event instead of an empty day', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    const user = { id: 'host-user', email: 'host@example.test', firstName: '太郎', lastName: '山田' };
    const group = { id: 'friends', name: 'いつメン', color: '#4E8A5A' };
    const candidates = [
      { id: 'cand-1', date: '2026-11-21', startTime: null },
      { id: 'cand-2', date: '2026-11-22', startTime: '12:00' },
    ];
    const poll = {
      id: 'poll-a', title: '餃子の会', status: 'open', deadlineAt: null, confirmedCandidateId: null,
      group, creatorId: user.id, hostName: '山田 太郎', candidates,
      answers: [],
    };
    await page.route(`${origin}/api/auth/me`, route => route.fulfill({ json: { user } }));
    await page.route(/\/api\/polls\/.*/, route => {
      const request = route.request();
      const action = new URL(request.url()).pathname.split('/')[4];
      if (request.method() === 'GET' && !action) return route.fulfill({ json: { poll } });
      if (request.method() === 'POST' && action === 'confirm') {
        poll.status = 'confirmed';
        poll.confirmedCandidateId = 'cand-1';
        return route.fulfill({ json: { poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: 'cand-1' }, event: { id: 'event-1' } } });
      }
      return route.fulfill({ status: 500, json: { error: 'unexpected' } });
    });

    await page.goto(`${origin}/polls/poll-a`);
    await page.getByRole('button', { name: 'この日程に確定する' }).click();
    await page.getByRole('heading', { name: '日程が決まりました', level: 1 }).waitFor();
    const sideDay = page.locator('.side-day');
    await sideDay.getByText('餃子の会').waitFor();
    assert.match((await sideDay.textContent()) ?? '', /終日/);
  } finally {
    await context.close();
    await browser.close();
  }
});

test('share cancellation is silent but share failure falls back to copy', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__shareMode = 'abort';
      window.__copied = [];
      Object.defineProperty(window.navigator, 'share', {
        configurable: true,
        value: async () => {
          if (window.__shareMode === 'abort') throw new DOMException('cancelled', 'AbortError');
          throw new Error('share target failed');
        },
      });
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => window.__copied.push(text) },
      });
    });
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    await page.goto(`${origin}/polls/sample`);
    await page.getByRole('button', { name: /に確定する/ }).tap();
    await page.getByRole('heading', { name: '日程が決まりました', level: 1 }).waitFor();

    await page.getByRole('button', { name: '決まった日程を共有' }).tap();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__copied.length), 0, 'share cancellation must not copy');

    await page.evaluate(() => { window.__shareMode = 'failure'; });
    await page.getByRole('button', { name: '決まった日程を共有' }).tap();
    await page.waitForFunction(() => window.__copied.length === 1);
  } finally {
    await context.close();
    await browser.close();
  }
});

test('members without tally permission see only their own answer state', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    const user = { id: 'member-user', email: 'member@example.test', firstName: '花子', lastName: '佐藤' };
    const group = { id: 'friends', name: 'いつメン', color: '#4E8A5A' };
    const poll = {
      id: 'poll-a', title: '餃子の会', status: 'open', deadlineAt: null, confirmedCandidateId: null,
      group, creatorId: 'host-user', hostName: '山田 太郎',
      candidates: [
        { id: 'cand-1', date: '2026-11-21', startTime: '19:00' },
        { id: 'cand-2', date: '2026-11-22', startTime: '12:00' },
      ],
      answers: [],
    };
    await page.route(`${origin}/api/auth/me`, route => route.fulfill({ json: { user } }));
    await page.route(/\/api\/polls\/.*/, route => route.fulfill({ json: { poll } }));

    await page.goto(`${origin}/polls/poll-a`);
    await page.getByText('あなたは未回答です', { exact: true }).waitFor();
    assert.equal(await page.getByText(/人中\d+人が回答/).count(), 0, 'members must not see a fake aggregate denominator');
    assert.equal(await page.locator('.counts').count(), 0, 'members must not see aggregate candidate counts');
    assert.equal(await page.getByText('参加できる人が最多').count(), 0, 'members must not see a best-candidate claim built from incomplete data');
  } finally {
    await context.close();
    await browser.close();
  }
});

test('a login-required poll appears without waiting for viewer identity', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    await page.route(`${origin}/api/auth/me`, () => new Promise(() => {}));
    await page.route(`${origin}/api/polls/gated`, route => route.fulfill({ status: 401, json: { error: 'unauthorized' } }));
    await page.goto(`${origin}/polls/gated`);
    await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
    await page.getByRole('link', { name: 'ログイン' }).waitFor();
  } finally {
    await context.close();
    await browser.close();
  }
});
