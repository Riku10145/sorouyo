import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

const user = { id: 'host-user', email: 'host@example.test', firstName: '太郎', lastName: '山田' };
const group = { id: 'friends', name: 'いつメン', color: '#4E8A5A' };
const candidates = [
  { id: 'cand-1', date: '2026-11-21', startTime: '19:00' },
  { id: 'cand-2', date: '2026-11-22', startTime: '12:00' },
];
const poll = {
  id: 'poll-a', title: '餃子の会', status: 'open', deadlineAt: null, confirmedCandidateId: null,
  group, creatorId: user.id, hostName: '山田 太郎', candidates,
  answers: [{ id: 'answer-hana', name: 'はな', comment: null, own: false, votes: { 'cand-1': 'yes', 'cand-2': 'no' }, createdAt: '2026-11-01T00:00:00Z' }],
};

async function boot(callback) {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:29229');
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
    await page.route(`${origin}/api/auth/me`, route => route.fulfill({ json: { user } }));
    await callback(page, origin);
  } finally {
    await context.close();
    await browser.close();
  }
}

test('host can edit poll candidates with vote-loss confirmation', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  await boot(async (page, origin) => {
    let patchBody = null;
    await page.addInitScript(() => {
      window.confirm = message => {
        const dialogs = JSON.parse(localStorage.getItem('test-dialogs') ?? '[]');
        dialogs.push(message);
        localStorage.setItem('test-dialogs', JSON.stringify(dialogs));
        return true;
      };
    });
    await page.route(`${origin}/api/polls/poll-a`, route => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON();
        return route.fulfill({ json: { poll: { id: 'poll-a', status: 'open' } } });
      }
      return route.fulfill({ json: { poll } });
    });
    await page.goto(`${origin}/polls/poll-a/edit`);
    await page.getByRole('heading', { name: '日程調整を編集', level: 1 }).waitFor();
    await page.getByLabel('予定名').fill('餃子の会（再調整）');
    await page.getByRole('button', { name: '候補2を削除' }).tap();
    await page.getByLabel('候補1の日付').fill('2026-11-23');
    await page.getByRole('button', { name: '候補日を追加' }).tap();
    await page.getByLabel('候補2の日付').fill('2026-11-24');
    await page.getByLabel('候補2の開始時刻').fill('18:30');
    await page.getByRole('button', { name: '変更を保存' }).tap();
    await page.getByRole('heading', { name: '餃子の会', level: 1 }).waitFor();

    const dialogs = await page.evaluate(() => JSON.parse(localStorage.getItem('test-dialogs') ?? '[]'));
    assert.equal(dialogs.length, 2);
    assert.match(dialogs[0], /1件の票/);
    assert.match(dialogs[1], /合計1件の票/);
    assert.equal(patchBody.title, '餃子の会（再調整）');
    assert.equal(patchBody.candidates.length, 2);
    assert.equal(patchBody.candidates[0].id, 'cand-1');
    assert.equal(patchBody.candidates[0].date, '2026-11-23');
    assert.equal(patchBody.candidates[1].id, undefined);
    assert.equal(patchBody.candidates[1].time, '18:30');
  });
});

test('host can unconfirm a poll and keep the same edit flow available', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  await boot(async (page, origin) => {
    let unconfirmed = false;
    await page.addInitScript(() => { window.confirm = () => true; });
    await page.route(`${origin}/api/polls/poll-a`, route => route.fulfill({ json: { poll: unconfirmed ? poll : { ...poll, status: 'confirmed', confirmedCandidateId: 'cand-1' } } }));
    await page.route(`${origin}/api/polls/poll-a/unconfirm`, route => {
      unconfirmed = true;
      return route.fulfill({ json: { poll: { id: 'poll-a', status: 'open' } } });
    });
    await page.goto(`${origin}/polls/poll-a`);
    await page.getByRole('button', { name: '確定を取り消して再調整' }).tap();
    await page.getByRole('heading', { name: '日程調整を編集', level: 1 }).waitFor();
    assert.equal(unconfirmed, true);
    await page.getByText('再調整を始めるには新しい回答締切を設定してください').waitFor();
  });
});

test('member can edit and delete a normal event from its detail', {
  skip: process.env.BROWSER_TEST !== '1' && 'BROWSER_TEST=1 が必要（npm run test:browser）',
}, async () => {
  await boot(async (page, origin) => {
    let patchBody = null;
    let deleted = false;
    const event = { id: 'event-1', date: '2026-11-21', startTime: '19:00', title: '夕食', memo: null, group, sourcePollId: null };
    await page.addInitScript(() => { window.confirm = () => true; });
    await page.route(`${origin}/api/events/event-1`, route => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON();
        return route.fulfill({ json: { event: { id: 'event-1' } } });
      }
      if (route.request().method() === 'DELETE') {
        deleted = true;
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: { event } });
    });
    await page.route(`${origin}/api/calendar?month=*`, route => route.fulfill({ json: { events: [] } }));
    await page.goto(`${origin}/events/event-1`);
    await page.getByRole('button', { name: '予定を編集' }).tap();
    await page.getByLabel('予定名').fill('夕食の買い出し');
    await page.getByLabel('日付').fill('2026-11-22');
    await page.getByLabel('開始時刻（空欄なら終日）').fill('');
    await page.getByLabel('メモ（任意）').fill('卵を買う');
    await page.getByRole('button', { name: '保存する' }).tap();
    await page.getByRole('heading', { name: '夕食の買い出し', level: 1 }).waitFor();
    assert.deepEqual(patchBody, { date: '2026-11-22', time: null, title: '夕食の買い出し', memo: '卵を買う' });

    await page.getByRole('button', { name: '削除' }).tap();
    await page.waitForURL(`${origin}/?date=2026-11-22`);
    assert.equal(deleted, true);
  });
});
