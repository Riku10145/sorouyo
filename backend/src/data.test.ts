import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, test, vi } from 'vitest';
import {
  STATE_COOKIE,
  SESSION_COOKIE,
  GUEST_COOKIE,
  buildAuthRoutes,
  guestRoutes,
  type AuthDeps,
  type SealedSession,
  type SessionUser,
  type WorkosClient,
} from './auth';
import { buildDataRoutes } from './data';
import type { DataEnv } from './context';
import { GROUP_CREATION_LIMIT } from '../../shared/limits';

function makeDb(beforeJoinInviteExpiryMigration?: (db: DatabaseSync) => void, includeAnalytics = true): D1Database {
  const db = new DatabaseSync(':memory:');
  const apply = (file: string) => db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  // 新しい migration を足したらここにも列挙する
  for (const file of ['0001_init.sql', '0002_invite_creator.sql']) apply(file);
  beforeJoinInviteExpiryMigration?.(db);
  apply('0003_join_invite_expiry.sql');
  if (includeAnalytics) apply('0004_analytics_events.sql');
  for (const file of ['0005_event_memo.sql', '0006_poll_edit_state.sql', '0007_notification_settings.sql', '0008_group_creator.sql']) apply(file);
  db.exec('PRAGMA foreign_keys = ON');
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      sql,
      bind(...v: unknown[]) { args = v; return stmt; },
      run: async () => {
        const r = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      first: async () => db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    };
    return stmt;
  };
  let batchQueue: Promise<void> = Promise.resolve();
  const shim = {
    prepare: (sql: string) => prepare(sql),
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      const previous = batchQueue;
      let release!: () => void;
      batchQueue = new Promise(resolve => { release = resolve; });
      await previous;
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        release();
      }
    },
  } as unknown as D1Database & { rawDb: DatabaseSync };
  shim.rawDb = db;
  return shim;
}

function rawDb(db: D1Database): DatabaseSync {
  return (db as D1Database & { rawDb: DatabaseSync }).rawDb;
}

const users: Record<string, SessionUser> = {
  code_host: { id: 'user_host', email: 'host@example.com', firstName: '一郎', lastName: '主催' },
  code_member: { id: 'user_member', email: 'member@example.com', firstName: '花子' },
  code_other: { id: 'user_other', email: 'other@example.com' },
};

function fakeWorkos(): WorkosClient {
  return {
    userManagement: {
      getAuthorizationUrl: () => 'https://workos.example/authorize',
      authenticateWithCode: async ({ code }) => {
        const user = users[code];
        if (!user) throw new Error('bad code');
        return { sealedSession: `sealed.${code}`, user };
      },
      loadSealedSession: ({ sessionData }): SealedSession => ({
        authenticate: vi.fn(async () => {
          const user = users[sessionData.replace('sealed.', '')];
          return user
            ? { authenticated: true as const, user, sessionId: `sess_${user.id}` }
            : { authenticated: false as const };
        }),
        refresh: vi.fn(async () => ({ authenticated: false as const })),
        getLogoutUrl: vi.fn(async () => 'https://workos.example/logout'),
      }),
    },
  };
}

function testApp(db: D1Database) {
  const deps: AuthDeps = {
    workos: fakeWorkos(),
    config: {
      clientId: 'client_1',
      cookiePassword: 'x'.repeat(40),
      redirectUri: 'https://app.example/api/auth/callback',
      logoutReturnTo: 'https://app.example/',
    },
  };
  return new Hono<{ Bindings: DataEnv }>()
    .route('/api/auth', buildAuthRoutes(() => deps))
    .route('/api/guest', guestRoutes)
    .route('/api', buildDataRoutes(() => deps));
}

const env = (db: D1Database, extra: Partial<DataEnv> = {}): DataEnv => ({
  DB: db,
  WORKOS_COOKIE_PASSWORD: 'x'.repeat(40),
  ANALYTICS_TOKEN: 'analytics-secret',
  ...extra,
});

const req = (app: ReturnType<typeof testApp>, db: D1Database, path: string, init?: RequestInit, bindings?: Partial<DataEnv>) =>
  app.request(`https://app.example${path}`, init, env(db, bindings));

const login = async (app: ReturnType<typeof testApp>, db: D1Database, code: string) => {
  const res = await req(app, db, `/api/auth/callback?code=${code}&state=x`, {
    headers: { cookie: `${STATE_COOKIE}=x` },
  });
  return res.headers.getSetCookie().find(v => v.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
};

const guest = async (app: ReturnType<typeof testApp>, db: D1Database) => {
  const res = await req(app, db, '/api/guest/session', { method: 'POST' });
  return res.headers.getSetCookie().find(v => v.startsWith(`${GUEST_COOKIE}=`))!.split(';')[0]!;
};

const post = (
  app: ReturnType<typeof testApp>, db: D1Database, path: string, body: unknown, cookie = '',
  bindings?: Partial<DataEnv>, headers: Record<string, string> = {},
) => req(app, db, path, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
}, bindings);

const mutate = (app: ReturnType<typeof testApp>, db: D1Database, method: 'PATCH' | 'DELETE', path: string, body: unknown, cookie = '') =>
  req(app, db, path, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** 主催がグループを作り調整を作成し、回答トークンを返す。 */
async function setupPoll(app: ReturnType<typeof testApp>, db: D1Database, host: string) {
  const g = await post(app, db, '/api/groups', { name: 'グループ' }, host);
  const { group } = await g.json() as { group: { id: string } };
  const p = await post(app, db, `/api/groups/${group.id}/polls`, {
    title: '花見',
    candidates: [
      { date: '2026-04-04', time: '18:00' },
      { date: '2026-04-11', time: '12:00' },
    ],
  }, host);
  const body = await p.json() as { poll: { id: string }; token: string };
  return { groupId: group.id, pollId: body.poll.id, token: body.token };
}

describe('data', () => {
  test('マイグレーション: 既存の参加リンクに期限を補完し、同時刻の複数リンクは最新1本だけ残す', async () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    const db = makeDb((raw) => {
      raw.prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`).run('group_legacy', 'legacy', createdAt);
      const insert = raw.prepare(`INSERT INTO invites (id, purpose, group_id, token_hash, created_at) VALUES (?, 'join', ?, ?, ?)`);
      for (const id of ['invite_a', 'invite_b', 'invite_c']) insert.run(id, 'group_legacy', `hash_${id}`, createdAt);
    });

    const rows = (await db.prepare(
      `SELECT id, expires_at, revoked_at FROM invites WHERE purpose = 'join' ORDER BY id`
    ).all()).results as { id: string; expires_at: string | null; revoked_at: string | null }[];
    expect(rows.map(row => row.expires_at)).toEqual([
      '2026-01-08T00:00:00.000Z',
      '2026-01-08T00:00:00.000Z',
      '2026-01-08T00:00:00.000Z',
    ]);
    expect(rows.filter(row => !row.revoked_at).map(row => row.id)).toEqual(['invite_c']);
  });

  test('マイグレーション: 既存グループの作成者を最初のadminから補完する', async () => {
    const db = makeDb((raw) => {
      raw.prepare(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run('user_owner', 'owner@example.com', 'owner', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      raw.prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
        .run('group_owned', 'legacy', '2026-01-01T00:00:00.000Z');
      raw.prepare(`INSERT INTO memberships (group_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)`)
        .run('group_owned', 'user_owner', '2026-01-01T00:00:00.000Z');
    });

    const row = await db.prepare(`SELECT created_by FROM groups WHERE id = 'group_owned'`).first() as { created_by: string | null };
    expect(row.created_by).toBe('user_owner');
  });

  test('永続化: 作成したグループ・調整・回答が別ブラウザ（別セッションCookie）でも同じように取れる', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { pollId, token } = await setupPoll(app, db, host);

    // ゲスト（端末B）が回答する
    const b = await guest(app, db);
    const answered = await post(app, db, '/api/invite/answer', {
      token, name: 'B子', votes: [{ candidateId: undefined, value: 'yes' }],
    }, b);
    const invite = await post(app, db, '/api/invite', { token }, b);
    const candId = (await invite.json() as { poll: { candidates: { id: string }[] } }).poll.candidates[0]!.id;
    const answer = await post(app, db, '/api/invite/answer', {
      token, name: 'B子', votes: [{ candidateId: candId, value: 'yes' }],
    }, b);
    expect(answer.status).toBe(200);
    expect(answered.status).toBe(400); // 未知の候補IDは400

    // 同じアカウントで再ログインした別ブラウザから同じデータが取れる
    const host2 = await login(app, db, 'code_host');
    const groups = await req(app, db, '/api/groups', { headers: { cookie: host2 } });
    const { groups: list } = await groups.json() as { groups: { id: string }[] };
    expect(list).toHaveLength(1);
    const poll = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host2 } });
    const { poll: seen } = await poll.json() as { poll: { answers: { name: string }[] } };
    expect(seen.answers.map(a => a.name)).toEqual(['B子']);
  });

  test('ほぼ同時の回答は両方残り、同一回答の再送は1件のまま（冪等）', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { pollId, token } = await setupPoll(app, db, host);
    const invite = await post(app, db, '/api/invite', { token });
    const { poll } = await invite.json() as { poll: { candidates: { id: string }[] } };
    const c1 = poll.candidates[0]!.id;
    const c2 = poll.candidates[1]!.id;

    const [b, c] = await Promise.all([guest(app, db), guest(app, db)]);
    const [r1, r2] = await Promise.all([
      post(app, db, '/api/invite/answer', { token, name: 'B子', votes: [{ candidateId: c1, value: 'yes' }] }, b),
      post(app, db, '/api/invite/answer', { token, name: 'C子', votes: [{ candidateId: c1, value: 'maybe' }, { candidateId: c2, value: 'no' }] }, c),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // 端末Bが同じ送信を再試行 → 上書きされても1件のまま
    const retry = await post(app, db, '/api/invite/answer', { token, name: 'B子', votes: [{ candidateId: c1, value: 'yes' }] }, b);
    expect(retry.status).toBe(200);

    const res = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const { poll: seen } = await res.json() as { poll: { answers: { name: string }[] } };
    expect(seen.answers.map(a => a.name).sort()).toEqual(['B子', 'C子']);
  });

  test('新規回答者が上限を超えると429になるが、既存回答の変更は通る', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { token } = await setupPoll(app, db, host);
    const invite = await post(app, db, '/api/invite', { token });
    const { poll } = await invite.json() as { poll: { candidates: { id: string }[] } };
    const c1 = poll.candidates[0]!.id;

    // 30人が直近1時間に新規回答
    const first = await guest(app, db);
    for (let i = 0; i < 30; i++) {
      const g = i === 0 ? first : await guest(app, db);
      const r = await post(app, db, '/api/invite/answer', { token, name: `回答者${i}`, votes: [{ candidateId: c1, value: 'yes' }] }, g);
      expect(r.status).toBe(200);
    }
    // 31人目の新規回答は429
    const extra = await guest(app, db);
    const limited = await post(app, db, '/api/invite/answer', { token, name: '31人目', votes: [{ candidateId: c1, value: 'yes' }] }, extra);
    expect(limited.status).toBe(429);
    // 既に回答済みの人の変更は制限されない
    const update = await post(app, db, '/api/invite/answer', { token, name: '回答者0', votes: [{ candidateId: c1, value: 'no' }] }, first);
    expect(update.status).toBe(200);
  });

  test('回答リンクの範囲は対象の調整と自分の回答だけ（他グループの予定・主催者操作は拒否）', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const other = await login(app, db, 'code_other');
    const { groupId, pollId, token } = await setupPoll(app, db, host);
    const b = await guest(app, db);

    // 他グループの予定は見えない
    expect((await req(app, db, '/api/calendar', { headers: { cookie: b } })).status).toBe(401);
    expect([401, 403]).toContain((await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: b } })).status);
    // 主催者操作は拒否（ゲスト/別アカウントどちらも）
    const confirmBody = JSON.stringify({ candidateId: 'x' });
    for (const cookie of [b, other]) {
      // 未ログインは401、ログイン済みの非メンバーは403（どちらも拒否）
      expect([401, 403]).toContain((await req(app, db, `/api/polls/${pollId}/confirm`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: confirmBody })).status);
      expect([401, 403]).toContain((await req(app, db, `/api/polls/${pollId}/invite`, { method: 'POST', headers: { cookie } })).status);
      expect([401, 403]).toContain((await req(app, db, `/api/groups/${groupId}/invites`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status);
    }
    // ログイン済みの非メンバーは有効なトークンがあっても回答できない（リンク回答者はゲスト扱い）
    expect((await post(app, db, '/api/invite/answer', {
      token, name: '他者', votes: [{ candidateId: 'x', value: 'yes' }],
    }, other)).status).toBe(403);

    // 悪いトークンは404
    expect((await post(app, db, '/api/invite', { token: 'bad' })).status).toBe(404);

    // ゲストCookie未発行の初回ゲストでも、リンクがあれば回答できる（サーバがCookieを発行する）
    const firstTimer = await post(app, db, '/api/invite', { token });
    const candId = (await firstTimer.json() as { poll: { candidates: { id: string }[] } }).poll.candidates[0]!.id;
    const res = await req(app, db, '/api/invite/answer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: '初回', votes: [{ candidateId: candId, value: 'maybe' }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some(v => v.startsWith(`${GUEST_COOKIE}=`))).toBe(true);

    // 自分の回答だけが返る（他人の回答は含まれない）
    await post(app, db, '/api/invite/answer', { token, name: '他人', votes: [{ candidateId: 'x', value: 'yes' }] }, await guest(app, db));
    const invite = await post(app, db, '/api/invite', { token }, b);
    const inviteJson = await invite.json() as { poll: { candidates: { id: string }[]; answers?: unknown } };
    expect(inviteJson.poll.answers).toBeUndefined();
    const c1 = inviteJson.poll.candidates[0]!.id;
    await post(app, db, '/api/invite/answer', { token, name: 'B子', votes: [{ candidateId: c1, value: 'yes' }] }, b);
    const invite2 = await post(app, db, '/api/invite', { token }, b);
    const { poll: seen } = await invite2.json() as { poll: { ownAnswer?: { name: string; votes: Record<string, string> } } };
    expect(seen.ownAnswer).toMatchObject({ name: 'B子', votes: { [c1]: 'yes' } });
  });

  test('回答リンクの再発行は旧リンクを失効させず、新旧どちらも使える', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { pollId, token } = await setupPoll(app, db, host);

    // 主催がコピーするたび新トークンは返るが、共有済みの旧リンクを殺さない（ベアラーリンクは複数有効）
    const reissued = await req(app, db, `/api/polls/${pollId}/invite`, { method: 'POST', headers: { cookie: host } });
    expect(reissued.status).toBe(201);
    const { token: token2 } = await reissued.json() as { token: string };
    expect(token2).not.toBe(token);

    const invite = await post(app, db, '/api/invite', { token });
    expect(invite.status).toBe(200);
    const candId = (await invite.json() as { poll: { candidates: { id: string }[] } }).poll.candidates[0]!.id;
    expect((await post(app, db, '/api/invite/answer', {
      token, name: '旧リンク', votes: [{ candidateId: candId, value: 'yes' }],
    }, await guest(app, db))).status).toBe(200);
    // 新リンクも従来どおり使える
    expect((await post(app, db, '/api/invite/answer', {
      token: token2, name: '新リンク', votes: [{ candidateId: candId, value: 'yes' }],
    }, await guest(app, db))).status).toBe(200);
  });

  test('確定すると回答は締め切られ、予定ができて、再確定は冪等・別候補は409', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const { groupId, pollId, token } = await setupPoll(app, db, host);

    // メンバーはjoinリンクで参加してカレンダーが見える
    const joinInvite = await req(app, db, `/api/groups/${groupId}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: joinToken } = await joinInvite.json() as { token: string };
    expect((await post(app, db, '/api/groups/join', { token: joinToken }, member)).status).toBe(201);

    const inviteRes = await post(app, db, '/api/invite', { token });
    const { poll } = await inviteRes.json() as { poll: { candidates: { id: string; date: string }[] } };
    const chosen = poll.candidates[0]!;
    const answerer = await guest(app, db);
    await post(app, db, '/api/invite/answer', { token, name: 'さき', votes: [{ candidateId: chosen.id, value: 'yes' }] }, answerer);

    const confirmed = await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: chosen.id }, host);
    expect(confirmed.status).toBe(200);
    const { event } = await confirmed.json() as { event: { id: string; date: string } };
    expect(event.date).toBe(chosen.date);

    // 同じ候補での再確定は同じ予定を返す（予定は増えない）
    const again = await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: chosen.id }, host);
    expect((await again.json() as { event: { id: string } }).event.id).toBe(event.id);
    // 別候補への差し替えは409
    expect((await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: poll.candidates[1]!.id }, host)).status).toBe(409);

    // カレンダーに予定が載る
    const cal = await req(app, db, '/api/calendar?month=2026-04', { headers: { cookie: member } });
    const { events } = await cal.json() as { events: { id: string }[] };
    expect(events.map(e => e.id)).toContain(event.id);

    // 確定後は新しい回答を受け付けない
    const late = await post(app, db, '/api/invite/answer', { token, name: '遅い人', votes: [{ candidateId: chosen.id, value: 'yes' }] }, await guest(app, db));
    expect(late.status).toBe(410);

    // 確定後の再送も、既存回答があっても受理表示せず410（古い控えを新しい回答に見せない）
    const resend = await post(app, db, '/api/invite/answer', { token, name: 'さき', votes: [{ candidateId: chosen.id, value: 'no' }] }, answerer);
    expect(resend.status).toBe(410);

    // 古い確定画面の取消は別候補への再確定を消せない
    expect((await post(app, db, `/api/polls/${pollId}/unconfirm`, { eventId: 'wrong-event' }, host)).status).toBe(409);
    const calStill = await req(app, db, '/api/calendar?month=2026-04', { headers: { cookie: member } });
    expect((await calStill.json() as { events: { id: string }[] }).events.map(e => e.id)).toEqual([event.id]);

    // 取消すると予定が消え、同じ回答リンクは残った候補への回答を保ったまま受付に戻る
    expect((await post(app, db, `/api/polls/${pollId}/unconfirm`, { eventId: event.id }, host)).status).toBe(200);
    const cal2 = await req(app, db, '/api/calendar?month=2026-04', { headers: { cookie: member } });
    expect((await cal2.json() as { events: unknown[] }).events).toHaveLength(0);
    const inviteAfter = await post(app, db, '/api/invite', { token }, answerer);
    const reopened = (await inviteAfter.json() as { poll: { accepting: boolean; confirmed: unknown; ownAnswer: { votes: Record<string, string> } } }).poll;
    expect(reopened.accepting).toBe(false);
    expect(reopened.confirmed).toBeNull();
    expect(reopened.ownAnswer.votes[chosen.id]).toBe('yes');

    // 新しい締切を保存するまでは受付を再開しない
    const memberView = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const editPoll = (await memberView.json() as { poll: { editVersion: number; candidates: { id: string; date: string; startTime: string | null }[] } }).poll;
    const deadlineAt = new Date(Date.now() + 86_400_000).toISOString();
    expect((await mutate(app, db, 'PATCH', `/api/polls/${pollId}`, {
      editVersion: editPoll.editVersion,
      title: '花見の日程',
      deadlineAt,
      candidates: editPoll.candidates.map(c => ({ id: c.id, date: c.date, time: c.startTime })),
    }, host)).status).toBe(200);
    const inviteReopened = await post(app, db, '/api/invite', { token }, answerer);
    expect(((await inviteReopened.json() as { poll: { accepting: boolean } }).poll).accepting).toBe(true);

    // 別候補で再確定すると新しい予定だけが1件載る
    const otherCandidate = poll.candidates[1]!;
    const reconfirmed = await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: otherCandidate.id }, host);
    expect(reconfirmed.status).toBe(200);
    const { event: nextEvent } = await reconfirmed.json() as { event: { id: string; date: string } };
    expect(nextEvent.id).not.toBe(event.id);
    expect(nextEvent.date).toBe(otherCandidate.date);
    const cal3 = await req(app, db, '/api/calendar?month=2026-04', { headers: { cookie: member } });
    const { events: currentEvents } = await cal3.json() as { events: { id: string }[] };
    expect(currentEvents.map(e => e.id)).toEqual([nextEvent.id]);

    // 前の確定画面が持つ古い予定IDでは、再確定済みの予定を取り消せない
    expect((await post(app, db, `/api/polls/${pollId}/unconfirm`, { eventId: event.id }, host)).status).toBe(409);
    const calAfterStaleUnconfirm = await req(app, db, '/api/calendar?month=2026-04', { headers: { cookie: member } });
    expect((await calAfterStaleUnconfirm.json() as { events: { id: string }[] }).events.map(e => e.id)).toEqual([nextEvent.id]);

    // 確定済みは削除できない。取消後は削除でき、リンクは無効案内になる
    expect((await mutate(app, db, 'DELETE', `/api/polls/${pollId}`, {}, host)).status).toBe(409);
    await post(app, db, `/api/polls/${pollId}/unconfirm`, { eventId: nextEvent.id }, host);
    expect((await mutate(app, db, 'DELETE', `/api/polls/${pollId}`, {}, host)).status).toBe(204);
    expect((await post(app, db, '/api/invite', { token }, answerer)).status).toBe(404);
  });

  test('候補が編集で消えた後の確定は競合になり、存在しない予定IDを返さない', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { pollId } = await setupPoll(app, db, host);
    const detail = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const { poll } = await detail.json() as { poll: { editVersion: number; candidates: { id: string; date: string; startTime: string | null }[] } };
    const removed = poll.candidates[0]!;
    const deadlineAt = new Date(Date.now() + 86_400_000).toISOString();
    expect((await mutate(app, db, 'PATCH', `/api/polls/${pollId}`, {
      editVersion: poll.editVersion,
      title: '花見の日程',
      deadlineAt,
      candidates: poll.candidates.slice(1).map(c => ({ id: c.id, date: c.date, time: c.startTime })),
    }, host)).status).toBe(200);

    // 編集前の画面が残していても、消えた候補では確定できない
    expect((await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: removed.id }, host)).status).toBe(400);
    const remaining = poll.candidates[1]!;
    const current = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const { poll: latest } = await current.json() as { poll: { editVersion: number } };
    // 確定APIが候補を照合した後、確定バッチの直前に編集APIの保存が入る競合を再現する
    const originalBatch = db.batch.bind(db);
    let editStatus = 0;
    db.batch = async (stmts) => {
      db.batch = originalBatch; // 内側の編集APIは通常どおりバッチを実行させる
      editStatus = (await mutate(app, db, 'PATCH', `/api/polls/${pollId}`, {
        editVersion: latest.editVersion,
        title: '花見の日程',
        deadlineAt,
        candidates: [{ date: '2026-04-05', time: null }],
      }, host)).status;
      return originalBatch(stmts);
    };
    const raced = await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: remaining.id }, host);
    expect(editStatus).toBe(200);
    expect(raced.status).toBe(409);
    const state = rawDb(db).prepare(`SELECT status, confirmed_candidate_id FROM polls WHERE id = ?`).get(pollId) as { status: string; confirmed_candidate_id: string | null };
    expect(state).toEqual({ status: 'open', confirmed_candidate_id: null });
    expect(rawDb(db).prepare(`SELECT COUNT(*) AS count FROM events WHERE source_poll_id = ?`).get(pollId)).toMatchObject({ count: 0 });
  });

  test('回答送信と候補編集が競合したら古い回答を上書きせず409になる', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { pollId, token } = await setupPoll(app, db, host);
    const invite = await post(app, db, '/api/invite', { token });
    const { poll } = await invite.json() as { poll: { candidates: { id: string; date: string; startTime: string | null }[] } };
    const [kept, replaced] = poll.candidates;
    const guestCookie = await guest(app, db);
    expect((await post(app, db, '/api/invite/answer', {
      token, name: '元の名前', comment: '元のメモ',
      votes: [{ candidateId: kept!.id, value: 'yes' }, { candidateId: replaced!.id, value: 'maybe' }],
    }, guestCookie)).status).toBe(200);

    const detail = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const { poll: latest } = await detail.json() as { poll: { editVersion: number } };
    const deadlineAt = new Date(Date.now() + 86_400_000).toISOString();
    // 回答APIが候補を照合した後、回答バッチの直前に編集APIの保存が入る競合を再現する
    const originalBatch = db.batch.bind(db);
    let editStatus = 0;
    db.batch = async (stmts) => {
      db.batch = originalBatch; // 内側の編集APIは通常どおりバッチを実行させる
      editStatus = (await mutate(app, db, 'PATCH', `/api/polls/${pollId}`, {
        editVersion: latest.editVersion,
        title: '花見の日程',
        deadlineAt,
        candidates: [
          { id: kept!.id, date: kept!.date, time: kept!.startTime },
          { date: '2026-04-05', time: null },
        ],
      }, host)).status;
      return originalBatch(stmts);
    };
    const raced = await post(app, db, '/api/invite/answer', {
      token, name: '変更名', comment: '変更メモ',
      votes: [{ candidateId: kept!.id, value: 'no' }, { candidateId: replaced!.id, value: 'yes' }],
    }, guestCookie);
    expect(editStatus).toBe(200);
    expect(raced.status).toBe(409);

    // 古いフォームの名前・票で部分的に上書きされていない（消えた候補の票だけ編集側の削除が残る）
    const after = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const { poll: saved } = await after.json() as { poll: { editVersion: number; answers: { name: string; comment: string | null; votes: Record<string, string> }[] } };
    expect(saved.answers[0]).toMatchObject({ name: '元の名前', comment: '元のメモ', votes: { [kept!.id]: 'yes' } });
    // 拒否した回答では編集バージョンを進めない（進んでいるのは主催者の編集分だけ）
    expect(saved.editVersion).toBe(latest.editVersion + 1);
  });

  test('グループ: 作成→名前・色の更新が一覧と予定に反映され、管理者以外は変更できない', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const other = await login(app, db, 'code_other');

    const created = await post(app, db, '/api/groups', { name: '家族', color: '#D97A3D' }, host);
    expect(created.status).toBe(201);
    const { group } = await created.json() as { group: { id: string; role: string } };
    expect(group.role).toBe('admin');
    // 色は16進のみ（自由テキストは400）
    expect((await post(app, db, '/api/groups', { name: 'x', color: 'red' }, host)).status).toBe(400);
    // 名前なしも400
    expect((await post(app, db, '/api/groups', { name: ' ' }, host)).status).toBe(400);

    // メンバーを参加させる
    const invite = await req(app, db, `/api/groups/${group.id}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: joinToken } = await invite.json() as { token: string };
    await post(app, db, '/api/groups/join', { token: joinToken }, member);

    // 管理者でないメンバー・非メンバーは更新できない
    expect((await req(app, db, `/api/groups/${group.id}`, {
      method: 'PATCH', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ name: '改名' }),
    })).status).toBe(403);
    expect((await req(app, db, `/api/groups/${group.id}`, {
      method: 'PATCH', headers: { cookie: other, 'content-type': 'application/json' }, body: JSON.stringify({ name: '改名' }),
    })).status).toBe(403);

    // 名前と色を変えると一覧・グループ詳細・カレンダーの予定に反映される
    const updated = await req(app, db, `/api/groups/${group.id}`, {
      method: 'PATCH', headers: { cookie: host, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '新しい家族', color: '#4E8A5A' }),
    });
    expect(updated.status).toBe(200);
    await post(app, db, `/api/groups/${group.id}/events`, { date: '2026-05-01', title: 'ピクニック' }, host);
    const list = await req(app, db, '/api/groups', { headers: { cookie: member } });
    expect((await list.json() as { groups: { name: string; color: string }[] }).groups[0]).toMatchObject({ name: '新しい家族', color: '#4E8A5A' });
    const cal = await req(app, db, '/api/calendar?month=2026-05', { headers: { cookie: member } });
    expect((await cal.json() as { events: { group: { name: string; color: string } }[] }).events[0]!.group)
      .toMatchObject({ name: '新しい家族', color: '#4E8A5A' });
  });

  test('グループ作成上限: migration後に旧Workerが作ったcreated_by未設定のグループも数える', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');

    rawDb(db).prepare(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('user_host', 'host@example.com', '主催 一郎', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    rawDb(db).prepare(`INSERT INTO groups (id, name, created_by, created_at) VALUES (?, ?, NULL, ?)`)
      .run('group_transition', '移行中のグループ', '2026-01-01T00:00:00.000Z');
    rawDb(db).prepare(`INSERT INTO memberships (group_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)`)
      .run('group_transition', 'user_host', '2026-01-01T00:00:00.000Z');

    for (let i = 0; i < GROUP_CREATION_LIMIT - 1; i++) {
      expect((await post(app, db, '/api/groups', { name: `作成${i}` }, host)).status).toBe(201);
    }
    expect((await post(app, db, '/api/groups', { name: '上限後' }, host)).status).toBe(409);
  });

  test('グループ作成上限: 上限超過は409で、参加グループは数えず削除するとまた作れる', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');

    const ownedIds: string[] = [];
    for (let i = 0; i < GROUP_CREATION_LIMIT; i++) {
      const created = await post(app, db, '/api/groups', { name: `作成${i}`, color: '#D97A3D' }, host);
      expect(created.status).toBe(201);
      ownedIds.push((await created.json() as { group: { id: string } }).group.id);
    }
    const limited = await post(app, db, '/api/groups', { name: '上限後', color: '#D97A3D' }, host);
    expect(limited.status).toBe(409);
    expect(await limited.json() as { error: string }).toEqual({ error: 'group_limit' });

    // 作成したグループを1件消すと、その分だけまた作れる
    expect((await req(app, db, `/api/groups/${ownedIds[0]}`, { method: 'DELETE', headers: { cookie: host } })).status).toBe(204);

    // 招待で参加したグループは作成数に入れない。所属数は上限でも作成数は上限より1件少ないまま
    const memberCreated = await post(app, db, '/api/groups', { name: '招待元', color: '#4E8A5A' }, member);
    const { group: invitedGroup } = await memberCreated.json() as { group: { id: string } };
    const invite = await req(app, db, `/api/groups/${invitedGroup.id}/invites`, { method: 'POST', headers: { cookie: member } });
    const { token } = await invite.json() as { token: string };
    expect((await post(app, db, '/api/groups/join', { token }, host)).status).toBe(201);

    const attempts = await Promise.all([
      post(app, db, '/api/groups', { name: '追加A', color: '#D97A3D' }, host),
      post(app, db, '/api/groups', { name: '追加B', color: '#D97A3D' }, host),
    ]);
    expect(attempts.map(response => response.status).sort()).toEqual([201, 409]);
    expect((await post(app, db, '/api/groups', { name: 'さらに追加', color: '#D97A3D' }, host)).status).toBe(409);
    expect((rawDb(db).prepare(`SELECT COUNT(*) AS n FROM groups WHERE created_by = 'user_host'`).get() as { n: number }).n).toBe(GROUP_CREATION_LIMIT);
  });

  test('グループ詳細: メンバー一覧と件数が取れ、削除は対象グループだけを消してリンクを無効化する', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');

    // 対象グループと、消えないことを確かめる別グループ
    const { groupId, pollId } = await setupPoll(app, db, host);
    const other = await post(app, db, '/api/groups', { name: '別グループ', color: '#7A5CA8' }, host);
    const { group: otherGroup } = await other.json() as { group: { id: string } };
    await post(app, db, `/api/groups/${otherGroup.id}/events`, { date: '2026-05-02', title: '残す予定' }, host);
    await post(app, db, `/api/groups/${groupId}/events`, { date: '2026-05-03', title: '消す予定' }, host);
    const joinRes = await req(app, db, `/api/groups/${groupId}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: joinToken } = await joinRes.json() as { token: string };
    await post(app, db, '/api/groups/join', { token: joinToken }, member);

    // 詳細: メンバー2人・予定1件・調整1件
    const detail = await req(app, db, `/api/groups/${groupId}`, { headers: { cookie: host } });
    const { members, counts } = await detail.json() as { members: { name: string; role: string; you: boolean }[]; counts: { events: number; polls: number; members: number } };
    expect(members.map(m => [m.name, m.role, m.you])).toEqual([['主催 一郎', 'admin', true], ['花子', 'member', false]]);
    expect(counts).toEqual({ events: 1, polls: 1, members: 2 });

    // メンバー・非ログインは削除できない
    expect((await req(app, db, `/api/groups/${groupId}`, { method: 'DELETE', headers: { cookie: member } })).status).toBe(403);
    expect((await req(app, db, `/api/groups/${groupId}`, { method: 'DELETE' })).status).toBe(401);

    // 管理者が削除すると、グループの予定・調整・参加リンク・所属が消える
    expect((await req(app, db, `/api/groups/${groupId}`, { method: 'DELETE', headers: { cookie: host } })).status).toBe(204);
    expect((await req(app, db, `/api/groups/${groupId}`, { headers: { cookie: host } })).status).toBe(403);
    expect((await post(app, db, '/api/groups/join/preview', { token: joinToken }, member)).status).toBe(404);
    expect((await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } })).status).toBe(404);
    const memberGroups = await req(app, db, '/api/groups', { headers: { cookie: member } });
    expect((await memberGroups.json() as { groups: unknown[] }).groups).toHaveLength(0);

    // 別グループの予定は残る
    const cal = await req(app, db, '/api/calendar?month=2026-05', { headers: { cookie: host } });
    const { events } = await cal.json() as { events: { title: string }[] };
    expect(events.map(e => e.title)).toEqual(['残す予定']);
  });

  test('参加リンク: プレビューはグループ名・招待元・見える予定を返し、参加は冪等で権限は変えない', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const created = await post(app, db, '/api/groups', { name: 'いつメン', color: '#4E8A5A' }, host);
    const { group } = await created.json() as { group: { id: string } };
    await post(app, db, `/api/groups/${group.id}/events`, { date: '2999-01-01', title: '遠い予定' }, host);
    const res = await req(app, db, `/api/groups/${group.id}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token } = await res.json() as { token: string };

    // 未ログインでもプレビューは見える（招待元・メンバー数・参加後に見える予定）
    const preview = await post(app, db, '/api/groups/join/preview', { token });
    expect(preview.status).toBe(200);
    const pv = await preview.json() as { group: { name: string }; inviterName: string; memberCount: number; upcoming: { title: string }[]; member: boolean };
    expect(pv.group.name).toBe('いつメン');
    expect(pv.inviterName).toBe('主催 一郎');
    expect(pv.memberCount).toBe(1);
    expect(pv.upcoming.map(e => e.title)).toEqual(['遠い予定']);
    expect(pv.member).toBe(false);

    // 参加前はグループも予定も見えない
    expect((await req(app, db, `/api/groups/${group.id}`, { headers: { cookie: member } })).status).toBe(403);

    // 未ログインは参加できない
    expect((await post(app, db, '/api/groups/join', { token })).status).toBe(401);

    // 参加 → メンバーに加わり、そのグループだけが開ける
    const joined = await post(app, db, '/api/groups/join', { token }, member);
    expect(joined.status).toBe(201);
    const j1 = await joined.json() as { already: boolean; group: { role: string } };
    expect(j1).toMatchObject({ already: false, group: { role: 'member' } });
    expect((await req(app, db, `/api/groups/${group.id}`, { headers: { cookie: member } })).status).toBe(200);

    // リンクを開き直してもメンバーは増えない（再参加は冪等・already=true）
    const again = await post(app, db, '/api/groups/join', { token }, member);
    expect(again.status).toBe(200);
    expect((await again.json() as { already: boolean }).already).toBe(true);
    const detail = await req(app, db, `/api/groups/${group.id}`, { headers: { cookie: member } });
    expect((await detail.json() as { counts: { members: number } }).counts.members).toBe(2);
    const preview2 = await post(app, db, '/api/groups/join/preview', { token }, member);
    expect((await preview2.json() as { member: boolean }).member).toBe(true);

    // 管理者が参加リンクを使っても役割は下がらない
    const hostJoin = await post(app, db, '/api/groups/join', { token }, host);
    expect((await hostJoin.json() as { group: { role: string }; already: boolean })).toMatchObject({ already: true, group: { role: 'admin' } });

    // 無効なトークンは404（プレビューも参加も）
    expect((await post(app, db, '/api/groups/join/preview', { token: 'bad' })).status).toBe(404);
    expect((await post(app, db, '/api/groups/join', { token: 'bad' }, member)).status).toBe(404);
  });

  test('参加リンク: 7日で期限切れ、再発行は旧リンクを失効させ、管理者は無効化できる', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const created = await post(app, db, '/api/groups', { name: 'いつメン' }, host);
    const { group } = await created.json() as { group: { id: string } };

    const issued = await req(app, db, `/api/groups/${group.id}/invites`, { method: 'POST', headers: { cookie: host } });
    expect(issued.status).toBe(201);
    const first = await issued.json() as { token: string; invite: { id: string; expiresAt: string; state: string } };
    expect(first.invite.state).toBe('active');
    const ttlMs = Date.parse(first.invite.expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);

    // 移行後に旧Workerが発行した期限なしリンクも、発行時刻から7日間は使える
    await db.prepare(`UPDATE invites SET expires_at = NULL WHERE id = ?`).bind(first.invite.id).run();
    expect((await post(app, db, '/api/groups/join/preview', { token: first.token })).status).toBe(200);
    const legacyDetail = await req(app, db, `/api/groups/${group.id}`, { headers: { cookie: host } });
    expect((await legacyDetail.json() as { joinInvite: { expiresAt: string | null; state: string } }).joinInvite)
      .toMatchObject({ state: 'active', expiresAt: expect.any(String) });

    // 期限なしリンクの効力は発行時刻+7日までで、それを過ぎると期限切れになる
    const oldCreatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(`UPDATE invites SET created_at = ? WHERE id = ?`).bind(oldCreatedAt, first.invite.id).run();
    expect((await post(app, db, '/api/groups/join/preview', { token: first.token })).status).toBe(404);
    const legacyExpiredDetail = await req(app, db, `/api/groups/${group.id}`, { headers: { cookie: host } });
    expect((await legacyExpiredDetail.json() as { joinInvite: { expiresAt: string; state: string } }).joinInvite)
      .toMatchObject({
        expiresAt: new Date(Date.parse(oldCreatedAt) + 7 * 24 * 60 * 60 * 1000).toISOString(),
        state: 'expired',
      });

    // 明示した期限切れでもプレビューできず、詳細には期限切れとして出る（発行から7日未満に戻して判定を切り分ける）
    await db.prepare(`UPDATE invites SET created_at = ?, expires_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), new Date(Date.now() - 1000).toISOString(), first.invite.id).run();
    expect((await post(app, db, '/api/groups/join/preview', { token: first.token })).status).toBe(404);
    const expiredDetail = await req(app, db, `/api/groups/${group.id}`, { headers: { cookie: host } });
    expect((await expiredDetail.json() as { joinInvite: { id: string; state: string } }).joinInvite)
      .toMatchObject({ id: first.invite.id, state: 'expired' });

    // 再発行すると旧リンクは失効し、新リンクだけが使える
    const reissued = await req(app, db, `/api/groups/${group.id}/invites`, { method: 'POST', headers: { cookie: host } });
    const second = await reissued.json() as { token: string; invite: { id: string; state: string } };
    expect(second.token).not.toBe(first.token);
    expect(second.invite.id).not.toBe(first.invite.id);
    expect((await post(app, db, '/api/groups/join/preview', { token: first.token })).status).toBe(404);
    expect((await post(app, db, '/api/groups/join/preview', { token: second.token })).status).toBe(200);

    // 管理者以外は無効化できない
    await post(app, db, '/api/groups/join', { token: second.token }, member);
    expect((await req(app, db, `/api/groups/${group.id}/invites/${second.invite.id}/revoke`, { method: 'POST', headers: { cookie: member } })).status).toBe(403);

    // 管理者が無効化するとリンクは404になり、状態は無効化済み。再送しても冪等に無効化済みを返す
    const revoked = await req(app, db, `/api/groups/${group.id}/invites/${second.invite.id}/revoke`, { method: 'POST', headers: { cookie: host } });
    expect(revoked.status).toBe(200);
    expect((await revoked.json() as { invite: { state: string } }).invite.state).toBe('revoked');
    expect((await post(app, db, '/api/groups/join/preview', { token: second.token })).status).toBe(404);
    const detail = await req(app, db, `/api/groups/${group.id}`, { headers: { cookie: host } });
    expect((await detail.json() as { joinInvite: { id: string; state: string } }).joinInvite)
      .toMatchObject({ id: second.invite.id, state: 'revoked' });
    expect((await req(app, db, `/api/groups/${group.id}/invites/${second.invite.id}/revoke`, { method: 'POST', headers: { cookie: host } })).status).toBe(200);

    // 無効化後も管理者はいつでも再発行できる
    const third = await req(app, db, `/api/groups/${group.id}/invites`, { method: 'POST', headers: { cookie: host } });
    expect(third.status).toBe(201);
    expect((await post(app, db, '/api/groups/join/preview', { token: (await third.json() as { token: string }).token })).status).toBe(200);
  });

  test('予定: 追加・月カレンダー・詳細は所属メンバーのみ（他グループの予定は見えない）', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const other = await login(app, db, 'code_other');
    const created = await post(app, db, '/api/groups', { name: '家族', color: '#D97A3D' }, host);
    const { group } = await created.json() as { group: { id: string } };
    const joinRes = await req(app, db, `/api/groups/${group.id}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token } = await joinRes.json() as { token: string };
    await post(app, db, '/api/groups/join', { token }, member);

    // 非メンバーは予定を作れない
    expect((await post(app, db, `/api/groups/${group.id}/events`, { date: '2026-06-10', title: 'x' }, other)).status).toBe(403);

    const made = await post(app, db, `/api/groups/${group.id}/events`, { date: '2026-06-10', time: '19:00', title: '夕食' }, member);
    expect(made.status).toBe(201);
    const { event } = await made.json() as { event: { id: string } };

    // 当月は見えて翌月には出ない
    const cal = await req(app, db, '/api/calendar?month=2026-06', { headers: { cookie: member } });
    const { events } = await cal.json() as { events: { id: string; title: string; startTime: string; group: { name: string; color: string } }[] };
    expect(events).toMatchObject([{ id: event.id, title: '夕食', startTime: '19:00', group: { name: '家族', color: '#D97A3D' } }]);
    const calNext = await req(app, db, '/api/calendar?month=2026-07', { headers: { cookie: member } });
    expect((await calNext.json() as { events: unknown[] }).events).toHaveLength(0);
    // 別アカウントの月には出ない
    const calOther = await req(app, db, '/api/calendar?month=2026-06', { headers: { cookie: other } });
    expect((await calOther.json() as { events: unknown[] }).events).toHaveLength(0);

    // 詳細はメンバーのみ
    const detail = await req(app, db, `/api/events/${event.id}`, { headers: { cookie: member } });
    expect(detail.status).toBe(200);
    expect((await detail.json() as { event: { title: string; sourcePollId: string | null } }).event).toMatchObject({ title: '夕食', sourcePollId: null });
    expect((await req(app, db, `/api/events/${event.id}`, { headers: { cookie: other } })).status).toBe(403);
    expect((await req(app, db, `/api/events/${event.id}`, { headers: { cookie: await guest(app, db) } })).status).toBe(401);
  });

  test('調整一覧: 所属グループの調整だけが状態・件数つきで返る（#27 一覧・#29 確定表示）', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const other = await login(app, db, 'code_other');
    const { groupId, pollId, token } = await setupPoll(app, db, host);
    const joinRes = await req(app, db, `/api/groups/${groupId}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: joinToken } = await joinRes.json() as { token: string };
    await post(app, db, '/api/groups/join', { token: joinToken }, member);

    // 1件回答を入れておく
    const invite = await post(app, db, '/api/invite', { token });
    const { poll: inv } = await invite.json() as { poll: { candidates: { id: string; date: string }[] } };
    await post(app, db, '/api/invite/answer', { token, name: 'B子', votes: [{ candidateId: inv.candidates[0]!.id, value: 'yes' }] }, await guest(app, db));

    // 未ログインは401、非メンバーは空リスト
    expect((await req(app, db, '/api/polls')).status).toBe(401);
    const otherList = await req(app, db, '/api/polls', { headers: { cookie: other } });
    expect((await otherList.json() as { polls: unknown[] }).polls).toHaveLength(0);

    // メンバーはグループの調整が見える（候補2日・回答1人・受付中・作成者ではない）
    const list = await req(app, db, '/api/polls', { headers: { cookie: member } });
    const { polls } = await list.json() as { polls: { id: string; title: string; accepting: boolean; group: { id: string }; creator: boolean; candidatesCount: number; answersCount: number; confirmed: unknown }[] };
    expect(polls).toHaveLength(1);
    expect(polls[0]).toMatchObject({
      id: pollId, title: '花見', accepting: true, creator: false,
      candidatesCount: 2, answersCount: 1, confirmed: null,
      group: { id: groupId },
    });

    // 確定すると確定日が返り、受付中ではなくなる
    await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: inv.candidates[0]!.id }, host);
    const list2 = await req(app, db, '/api/polls', { headers: { cookie: member } });
    const { polls: after } = await list2.json() as { polls: { status: string; accepting: boolean; confirmed: { date: string; startTime: string | null } | null }[] };
    expect(after[0]).toMatchObject({ status: 'confirmed', accepting: false, confirmed: { date: '2026-04-04', startTime: '18:00' } });
  });

  test('調整の作成: 候補0件は400、メンバーも作成でき、締切過去は受付終了で返る', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const other = await login(app, db, 'code_other');
    const created = await post(app, db, '/api/groups', { name: 'いつメン' }, host);
    const { group } = await created.json() as { group: { id: string } };
    const joinRes = await req(app, db, `/api/groups/${group.id}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: joinToken } = await joinRes.json() as { token: string };
    await post(app, db, '/api/groups/join', { token: joinToken }, member);

    // 候補0件・非メンバーは作成できない
    expect((await post(app, db, `/api/groups/${group.id}/polls`, { title: 'x', candidates: [] }, host)).status).toBe(400);
    expect((await post(app, db, `/api/groups/${group.id}/polls`, { title: 'x', candidates: [{ date: '2026-06-01' }] }, other)).status).toBe(403);

    // メンバー（管理者でなくても）も作成でき、回答リンクが発行される
    const made = await post(app, db, `/api/groups/${group.id}/polls`, {
      title: '締切過去の調整',
      deadlineAt: '2020-01-01T00:00:00.000Z',
      candidates: [{ date: '2026-06-01', time: null }, { date: '2026-06-02', time: '19:00' }],
    }, member);
    expect(made.status).toBe(201);
    const { poll: p2, token } = await made.json() as { poll: { id: string }; token: string };

    // 一覧では締切済み（accepting=false）として返る
    const list = await req(app, db, '/api/polls', { headers: { cookie: member } });
    const { polls } = await list.json() as { polls: { id: string; accepting: boolean; creator: boolean }[] };
    expect(polls.find(p => p.id === p2.id)).toMatchObject({ accepting: false, creator: true });

    // ゲストの回答リンクでも受付終了が分かり、回答は410
    const inviteRes = await post(app, db, '/api/invite', { token });
    const { poll: inv } = await inviteRes.json() as { poll: { accepting: boolean; candidates: { id: string }[] } };
    expect(inv.accepting).toBe(false);
    expect((await post(app, db, '/api/invite/answer', { token, name: 'x', votes: [{ candidateId: inv.candidates[0]!.id, value: 'yes' }] }, await guest(app, db))).status).toBe(410);
  });

  test('#7 催促対象: 作成者には回答済みかの分類が返り、メンバーには返らない', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const { groupId, pollId, token } = await setupPoll(app, db, host);
    const joinRes = await req(app, db, `/api/groups/${groupId}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: joinToken } = await joinRes.json() as { token: string };
    await post(app, db, '/api/groups/join', { token: joinToken }, member);

    // 誰も答えていない間は全員が未回答
    const before = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const { poll: seenBefore } = await before.json() as { poll: { members: { name: string; answered: boolean }[] } };
    expect(seenBefore.members).toHaveLength(2);
    expect(seenBefore.members.every(m => !m.answered)).toBe(true);

    // メンバーが回答すると、その人だけが回答済みになる
    const invite = await post(app, db, '/api/invite', { token }, member);
    const candId = (await invite.json() as { poll: { candidates: { id: string }[] } }).poll.candidates[0]!.id;
    const answered = await post(app, db, '/api/invite/answer', {
      token, name: '花子', comment: '19時以降なら', votes: [{ candidateId: candId, value: 'maybe' }],
    }, member);
    expect(answered.status).toBe(200);

    const after = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const { poll: seen } = await after.json() as {
      poll: { members: { id: string; answered: boolean }[]; answers: { name: string; comment: string | null }[] };
    };
    const byId = Object.fromEntries(seen.members.map(m => [m.id, m.answered]));
    expect(byId.user_member).toBe(true);
    expect(byId.user_host).toBe(false);
    // #8: 作成者は投票内容と一緒にコメントを読める
    expect(seen.answers[0]).toMatchObject({ name: '花子', comment: '19時以降なら' });

    // 作成者でないメンバーには分類を返さない（催促は主催者の操作）
    const asMember = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: member } });
    const { poll: memberSeen } = await asMember.json() as { poll: { members: unknown[] } };
    expect(memberSeen.members).toEqual([]);
  });

  test('#8 コメントは回答した調整ごとに分かれ、他の調整に混ざらない', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const first = await setupPoll(app, db, host);
    const secondRes = await post(app, db, `/api/groups/${first.groupId}/polls`, {
      title: '打ち合わせ',
      candidates: [{ date: '2026-04-05', time: '19:00' }],
    }, host);
    const second = await secondRes.json() as { poll: { id: string }; token: string };
    const guestCookie = await guest(app, db);

    const answerOn = async (token: string, comment: string) => {
      const invite = await post(app, db, '/api/invite', { token }, guestCookie);
      const { poll } = await invite.json() as { poll: { candidates: { id: string }[] } };
      const res = await post(app, db, '/api/invite/answer', {
        token, name: '花子', comment, votes: [{ candidateId: poll.candidates[0]!.id, value: 'maybe' }],
      }, guestCookie);
      expect(res.status).toBe(200);
    };
    await answerOn(first.token, '19時以降なら');
    await answerOn(second.token, '翌日なら');

    const readAnswers = async (pollId: string) => {
      const res = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
      const { poll } = await res.json() as { poll: { answers: { name: string; comment: string | null }[] } };
      return poll.answers;
    };
    expect(await readAnswers(first.pollId)).toEqual([expect.objectContaining({ name: '花子', comment: '19時以降なら' })]);
    expect(await readAnswers(second.poll.id)).toEqual([expect.objectContaining({ name: '花子', comment: '翌日なら' })]);
  });

  test('#32 通知設定: 保存と読み出しができ、未設定は無効・既定時刻、不正な時刻は400', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const other = await login(app, db, 'code_other');

    // 未ログインは読み書きともに401
    expect((await req(app, db, '/api/settings/notifications')).status).toBe(401);

    // 未設定なら無効・08:00
    const initial = await req(app, db, '/api/settings/notifications', { headers: { cookie: host } });
    expect(await initial.json()).toEqual({ enabled: false, time: '08:00' });

    // 保存して読み直すと同じ値。利用者ごとに独立している
    const put = await req(app, db, '/api/settings/notifications', {
      method: 'PUT', headers: { cookie: host, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, time: '07:30' }),
    });
    expect(put.status).toBe(200);
    const saved = await req(app, db, '/api/settings/notifications', { headers: { cookie: host } });
    expect(await saved.json()).toEqual({ enabled: true, time: '07:30' });
    const untouched = await req(app, db, '/api/settings/notifications', { headers: { cookie: other } });
    expect(await untouched.json()).toEqual({ enabled: false, time: '08:00' });

    // 切ると無効が保存される
    await req(app, db, '/api/settings/notifications', {
      method: 'PUT', headers: { cookie: host, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, time: '07:30' }),
    });
    expect(await (await req(app, db, '/api/settings/notifications', { headers: { cookie: host } })).json())
      .toEqual({ enabled: false, time: '07:30' });

    // 時刻の形式が不正なら400
    expect((await req(app, db, '/api/settings/notifications', {
      method: 'PUT', headers: { cookie: host, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, time: '25:00' }),
    })).status).toBe(400);
  });

  test('通常予定はメンバーが編集・削除でき、調整由来の予定は日時を直接変えられない', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const created = await post(app, db, '/api/groups', { name: '家族' }, host);
    const { group } = await created.json() as { group: { id: string } };
    const joinRes = await req(app, db, `/api/groups/${group.id}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: joinToken } = await joinRes.json() as { token: string };
    await post(app, db, '/api/groups/join', { token: joinToken }, member);

    const made = await post(app, db, `/api/groups/${group.id}/events`, { date: '2026-06-10', time: '19:00', title: '夕食' }, host);
    const { event } = await made.json() as { event: { id: string } };
    const patched = await mutate(app, db, 'PATCH', `/api/events/${event.id}`, { date: '2026-06-11', time: null, title: '夕食の買い出し', memo: '卵を買う' }, member);
    expect(patched.status).toBe(200);
    const detail = await req(app, db, `/api/events/${event.id}`, { headers: { cookie: member } });
    expect((await detail.json() as { event: { date: string; startTime: string | null; title: string; memo: string | null } }).event)
      .toMatchObject({ date: '2026-06-11', startTime: null, title: '夕食の買い出し', memo: '卵を買う' });

    expect((await mutate(app, db, 'DELETE', `/api/events/${event.id}`, {}, member)).status).toBe(204);
    expect((await req(app, db, `/api/events/${event.id}`, { headers: { cookie: member } })).status).toBe(404);

    // 調整由来の予定はタイトルとメモだけ直接変えられ、日時変更入力は無視される。直接削除はできない
    const { groupId: pollGroupId, pollId, token } = await setupPoll(app, db, host);
    const pollJoin = await req(app, db, `/api/groups/${pollGroupId}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: pollJoinToken } = await pollJoin.json() as { token: string };
    await post(app, db, '/api/groups/join', { token: pollJoinToken }, member);
    const invite = await post(app, db, '/api/invite', { token });
    const { poll } = await invite.json() as { poll: { candidates: { id: string }[] } };
    const confirmed = await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: poll.candidates[0]!.id }, host);
    const { event: pollEvent } = await confirmed.json() as { event: { id: string; date: string } };
    const patchPollEvent = await mutate(app, db, 'PATCH', `/api/events/${pollEvent.id}`, { date: '2026-12-01', time: '10:00', title: '別名', memo: '調整メモ' }, member);
    expect(patchPollEvent.status).toBe(200);
    const pollEventDetail = await req(app, db, `/api/events/${pollEvent.id}`, { headers: { cookie: member } });
    expect((await pollEventDetail.json() as { event: { date: string; title: string; memo: string | null } }).event)
      .toMatchObject({ date: pollEvent.date, title: '別名', memo: '調整メモ' });
    expect((await mutate(app, db, 'DELETE', `/api/events/${pollEvent.id}`, {}, member)).status).toBe(409);
  });

  test('受付中の調整は主催者が編集でき、変わった候補の票だけ消える', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const member = await login(app, db, 'code_member');
    const { groupId, pollId, token } = await setupPoll(app, db, host);
    const joinRes = await req(app, db, `/api/groups/${groupId}/invites`, { method: 'POST', headers: { cookie: host } });
    const { token: joinToken } = await joinRes.json() as { token: string };
    await post(app, db, '/api/groups/join', { token: joinToken }, member);

    const invite = await post(app, db, '/api/invite', { token });
    const { poll } = await invite.json() as { poll: { candidates: { id: string; date: string; startTime: string | null }[] } };
    const [first, second] = poll.candidates;
    const answerer = await guest(app, db);
    await post(app, db, '/api/invite/answer', { token, name: 'さき', votes: [
      { candidateId: first!.id, value: 'yes' }, { candidateId: second!.id, value: 'no' },
    ] }, answerer);

    // メンバー編集は403。主催者は候補1を保持し、候補2の日付変更を削除＋追加として保存できる
    expect((await mutate(app, db, 'PATCH', `/api/polls/${pollId}`, { editVersion: 0, title: 'x', candidates: [{ id: first!.id, date: first!.date, time: first!.startTime }] }, member)).status).toBe(403);
    const beforeEdit = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const editVersion = (await beforeEdit.json() as { poll: { editVersion: number } }).poll.editVersion;
    const otherAnswerer = await guest(app, db);
    await post(app, db, '/api/invite/answer', { token, name: 'あとから', votes: [{ candidateId: first!.id, value: 'yes' }] }, otherAnswerer);
    expect((await mutate(app, db, 'PATCH', `/api/polls/${pollId}`, {
      editVersion,
      title: '古い画面から保存',
      candidates: [{ id: first!.id, date: first!.date, time: first!.startTime }],
    }, host)).status).toBe(409);
    const refreshedEdit = await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: host } });
    const freshVersion = (await refreshedEdit.json() as { poll: { editVersion: number } }).poll.editVersion;
    const patched = await mutate(app, db, 'PATCH', `/api/polls/${pollId}`, {
      editVersion: freshVersion,
      title: '花見の日程変更',
      deadlineAt: '2027-01-01T00:00:00.000Z',
      candidates: [
        { id: first!.id, date: first!.date, time: first!.startTime },
        { id: second!.id, date: '2026-04-12', time: second!.startTime },
        { date: '2026-04-18', time: '10:00' },
      ],
    }, host);
    expect(patched.status).toBe(200);

    const after = await post(app, db, '/api/invite', { token }, answerer);
    const changed = (await after.json() as { poll: { title: string; deadlineAt: string; candidates: { id: string; date: string }[]; ownAnswer: { votes: Record<string, string> } } }).poll;
    expect(changed.title).toBe('花見の日程変更');
    expect(changed.deadlineAt).toBe('2027-01-01T00:00:00.000Z');
    expect(changed.candidates).toHaveLength(3);
    expect(changed.candidates[0]!.id).toBe(first!.id);
    expect(changed.candidates[1]!.id).not.toBe(second!.id);
    expect(changed.ownAnswer.votes[first!.id]).toBe('yes');
    expect(changed.ownAnswer.votes[second!.id]).toBeUndefined();
    expect(changed.ownAnswer.votes[changed.candidates[1]!.id]).toBeUndefined();

    // 編集前の古い回答フォームから、消えた候補を混ぜた送信は一部だけ受理しない
    const staleSubmit = await post(app, db, '/api/invite/answer', { token, name: 'さき', votes: [
      { candidateId: first!.id, value: 'no' }, { candidateId: second!.id, value: 'yes' },
    ] }, answerer);
    expect(staleSubmit.status).toBe(409);
    const allStaleSubmit = await post(app, db, '/api/invite/answer', { token, name: 'さき', votes: [
      { candidateId: second!.id, value: 'yes' },
    ] }, answerer);
    expect(allStaleSubmit.status).toBe(409);
    const afterStale = await post(app, db, '/api/invite', { token }, answerer);
    expect(((await afterStale.json() as { poll: { ownAnswer: { votes: Record<string, string> } } }).poll.ownAnswer.votes[first!.id])).toBe('yes');

    // 確定済みは編集できない
    const confirm = await post(app, db, `/api/polls/${pollId}/confirm`, { candidateId: first!.id }, host);
    expect(confirm.status).toBe(200);
    expect((await mutate(app, db, 'PATCH', `/api/polls/${pollId}`, { editVersion: 0, title: 'x', candidates: [{ id: first!.id, date: first!.date, time: first!.startTime }] }, host)).status).toBe(409);
  });

  test('計測: 有効リンク訪問と回答完了を匿名IDで重複除外し、30日の日別率を返す', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { token } = await setupPoll(app, db, host);
    const guestCookie = await guest(app, db);

    // 無効リンクは分母に入らない。有効リンクの再読込は同じ匿名訪問者なら1回だけ
    expect((await post(app, db, '/api/invite', { token: 'invalid' }, guestCookie)).status).toBe(404);
    const firstOpen = await post(app, db, '/api/invite', { token }, guestCookie);
    expect(firstOpen.status).toBe(200);
    expect((await post(app, db, '/api/invite', { token }, guestCookie)).status).toBe(200);
    const { poll } = await firstOpen.json() as { poll: { candidates: { id: string }[] } };
    const candidateId = poll.candidates[0]!.id;
    const answerBody = { token, name: '秘密の名前', comment: '秘密のメモ', votes: [{ candidateId, value: 'yes' }] };
    expect((await post(app, db, '/api/invite/answer', answerBody, guestCookie)).status).toBe(200);
    // 回答の更新再送は分子を増やさない
    expect((await post(app, db, '/api/invite/answer', answerBody, guestCookie)).status).toBe(200);

    expect((await req(app, db, '/api/analytics/funnel')).status).toBe(401);
    const res = await req(app, db, '/api/analytics/funnel', { headers: { authorization: 'Bearer analytics-secret' } });
    expect(res.status).toBe(200);
    const funnel = await res.json() as {
      range: { days: number };
      totals: { validLinkVisits: number; answerCompletions: number; completionRate: number | null };
      daily: { date: string; validLinkVisits: number; answerCompletions: number; completionRate: number | null }[];
    };
    expect(funnel.range.days).toBe(30);
    expect(funnel.daily).toHaveLength(30);
    expect(funnel.totals).toMatchObject({ validLinkVisits: 1, answerCompletions: 1, completionRate: 1, usageStartClicks: 0, usageStarts: 0 });
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    expect(funnel.daily.find(day => day.date === today)).toMatchObject({ validLinkVisits: 1, answerCompletions: 1, completionRate: 1 });

    // 計測イベントには表示名・予定名・コメント・リンク秘密部分を保存しない
    const rows = await db.prepare(`SELECT * FROM analytics_events`).all() as { results: Record<string, unknown>[] };
    expect(rows.results).toHaveLength(2);
    const serialized = JSON.stringify(rows.results);
    for (const secret of ['秘密の名前', '秘密のメモ', '花見', token]) expect(serialized.includes(secret)).toBe(false);
  });

  test('計測: 回答者の作成クリックと初回グループ作成を同じ匿名IDで記録し、回答元グループに所属させない', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { groupId, token } = await setupPoll(app, db, host);
    const guestCookie = await guest(app, db);

    const opened = await post(app, db, '/api/invite', { token }, guestCookie);
    const { poll } = await opened.json() as { poll: { candidates: { id: string }[] } };
    const answerBody = { token, name: 'ゲスト花子', comment: '秘密のひとこと', votes: [{ candidateId: poll.candidates[0]!.id, value: 'yes' }] };
    expect((await post(app, db, '/api/invite/answer', answerBody, guestCookie)).status).toBe(200);
    expect((await post(app, db, '/api/invite/usage-start-click', { token }, guestCookie)).status).toBe(204);
    expect((await post(app, db, '/api/invite/usage-start-click', { token }, guestCookie)).status).toBe(204);

    const memberCookie = await login(app, db, 'code_member');
    const memberWithGuest = `${guestCookie}; ${memberCookie}`;
    const first = await post(app, db, '/api/groups', { name: '自分の家族', color: '#4E8A5A' }, memberWithGuest);
    expect(first.status).toBe(201);
    const { group: ownGroup } = await first.json() as { group: { id: string } };
    const second = await post(app, db, '/api/groups', { name: '2件目', color: '#D97A3D' }, memberWithGuest);
    expect(second.status).toBe(201);
    const { group: secondGroup } = await second.json() as { group: { id: string } };

    const rows = await db.prepare(
      `SELECT event_type, visitor_id, invite_id, poll_id FROM analytics_events WHERE event_type IN ('answer_submit', 'usage_start_click', 'usage_start')`
    ).all() as { results: { event_type: string; visitor_id: string; invite_id: string; poll_id: string }[] };
    const byType = (type: string) => rows.results.filter(row => row.event_type === type);
    expect(byType('answer_submit')).toHaveLength(1);
    expect(byType('usage_start_click')).toHaveLength(1);
    expect(byType('usage_start')).toHaveLength(1);
    const answerEvent = byType('answer_submit')[0]!;
    expect(byType('usage_start_click')[0]).toMatchObject({ visitor_id: answerEvent.visitor_id, invite_id: answerEvent.invite_id, poll_id: answerEvent.poll_id });
    expect(byType('usage_start')[0]).toMatchObject({ visitor_id: answerEvent.visitor_id, invite_id: answerEvent.invite_id, poll_id: answerEvent.poll_id });

    const memberships = rawDb(db).prepare(`SELECT group_id, role FROM memberships WHERE user_id = 'user_member' ORDER BY created_at`).all() as { group_id: string; role: string }[];
    expect(memberships).toHaveLength(2);
    expect(memberships.map(row => row.group_id)).not.toContain(groupId);
    expect(memberships[0]).toMatchObject({ group_id: ownGroup.id, role: 'admin' });

    // 計測済みなら、全件削除後の再作成でも別の利用開始を増やさない
    expect((await mutate(app, db, 'DELETE', `/api/groups/${ownGroup.id}`, null, memberWithGuest)).status).toBe(204);
    expect((await mutate(app, db, 'DELETE', `/api/groups/${secondGroup.id}`, null, memberWithGuest)).status).toBe(204);
    const recreated = await post(app, db, '/api/groups', { name: '作り直し' }, memberWithGuest);
    expect(recreated.status).toBe(201);
    const { group: recreatedGroup } = await recreated.json() as { group: { id: string } };
    let usageRows = await db.prepare(`SELECT * FROM analytics_events WHERE event_type = 'usage_start'`).all() as { results: unknown[] };
    expect(usageRows.results).toHaveLength(1);

    const otherCookie = await login(app, db, 'code_other');
    expect((await post(app, db, '/api/groups', { name: '回答なし' }, otherCookie)).status).toBe(201);
    usageRows = await db.prepare(`SELECT * FROM analytics_events WHERE event_type = 'usage_start'`).all() as { results: unknown[] };
    expect(usageRows.results).toHaveLength(1);

    const funnelRes = await req(app, db, '/api/analytics/funnel', { headers: { authorization: 'Bearer analytics-secret' } });
    const funnel = await funnelRes.json() as { totals: { usageStartClicks: number; usageStarts: number; usageStartClickRate: number | null; usageStartRate: number | null } };
    expect(funnel.totals).toMatchObject({ usageStartClicks: 1, usageStarts: 1, usageStartClickRate: 1, usageStartRate: 1 });

    const serialized = JSON.stringify(await db.prepare(`SELECT * FROM analytics_events`).all());
    for (const secret of ['ゲスト花子', '秘密のひとこと', token]) expect(serialized.includes(secret)).toBe(false);

    // 別招待に回答してから作り直しても、visitor-wide な利用開始は重複しない
    const { token: secondToken } = await setupPoll(app, db, host);
    const secondOpened = await post(app, db, '/api/invite', { token: secondToken }, guestCookie);
    const { poll: secondPoll } = await secondOpened.json() as { poll: { candidates: { id: string }[] } };
    expect((await post(app, db, '/api/invite/answer', {
      token: secondToken,
      name: 'ゲスト花子',
      votes: [{ candidateId: secondPoll.candidates[0]!.id, value: 'yes' }],
    }, guestCookie)).status).toBe(200);
    expect((await mutate(app, db, 'DELETE', `/api/groups/${recreatedGroup.id}`, null, memberWithGuest)).status).toBe(204);
    expect((await post(app, db, '/api/groups', { name: '別招待後の作り直し' }, memberWithGuest)).status).toBe(201);
    usageRows = await db.prepare(`SELECT * FROM analytics_events WHERE event_type = 'usage_start'`).all() as { results: unknown[] };
    expect(usageRows.results).toHaveLength(1);
  });

  test('計測: Cookieなしの回答でも発行Cookieと回答者が一致し、計測表未適用でも招待は開ける', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { token } = await setupPoll(app, db, host);
    const opened = await post(app, db, '/api/invite', { token });
    const { poll } = await opened.json() as { poll: { candidates: { id: string }[] } };

    // 有効CookieなしのAPI送信では、回答保存に使ったIDそのものをブラウザへ返す
    const answer = await post(app, db, '/api/invite/answer', {
      token, name: '直接送信', votes: [{ candidateId: poll.candidates[0]!.id, value: 'yes' }],
    });
    expect(answer.status).toBe(200);
    const issued = answer.headers.getSetCookie().find(v => v.startsWith(`${GUEST_COOKIE}=`))!.split(';')[0]!;
    const reopened = await post(app, db, '/api/invite', { token }, issued);
    expect(((await reopened.json() as { poll: { ownAnswer: { name: string } | null } }).poll.ownAnswer)?.name).toBe('直接送信');

    // 新しい計測テーブルの適用が遅れていても、既存の招待表示と回答は止めない
    const oldDb = makeDb(undefined, false);
    const oldApp = testApp(oldDb);
    const oldHost = await login(oldApp, oldDb, 'code_host');
    const oldPoll = await setupPoll(oldApp, oldDb, oldHost);
    expect((await post(oldApp, oldDb, '/api/invite', { token: oldPoll.token })).status).toBe(200);
    const oldInvite = await post(oldApp, oldDb, '/api/invite', { token: oldPoll.token });
    const oldCandidate = (await oldInvite.json() as { poll: { candidates: { id: string }[] } }).poll.candidates[0]!.id;
    expect((await post(oldApp, oldDb, '/api/invite/answer', {
      token: oldPoll.token, name: '互換確認', votes: [{ candidateId: oldCandidate, value: 'yes' }],
    })).status).toBe(200);
  });

  test('回答API: 回答トークン×ゲスト識別子のレート制限は429と案内文を返す', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { token } = await setupPoll(app, db, host);
    const invite = await post(app, db, '/api/invite', { token });
    const { poll } = await invite.json() as { poll: { candidates: { id: string }[] } };
    const keys: string[] = [];
    const rateLimit = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;

    const res = await post(app, db, '/api/invite/answer', {
      token,
      name: 'A子',
      votes: [{ candidateId: poll.candidates[0]!.id, value: 'yes' }],
    }, await guest(app, db), { ANSWER_RESPONDENT_RATE_LIMIT: rateLimit });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited', message: '少し時間をおいてもう一度お試しください' });
    expect(keys[0]).toMatch(/^answer-respondent:[a-f0-9]{64}:g:/);
  });

  test('回答API: IPのレート制限はcf-connecting-ipをキーにして429を返す', async () => {
    const db = makeDb();
    const app = testApp(db);
    const keys: string[] = [];
    const rateLimit = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;

    const res = await post(app, db, '/api/invite/answer', { token: 'bad', name: 'A子', votes: [] }, '', {
      ANSWER_IP_RATE_LIMIT: rateLimit,
    }, { 'cf-connecting-ip': '203.0.113.9' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited', message: '少し時間をおいてもう一度お試しください' });
    expect(keys).toEqual(['answer-ip:203.0.113.9']);
  });

  test('回答API: 不正な本文の送信もIPの回数枠を使う', async () => {
    const db = makeDb();
    const app = testApp(db);
    const bindings = { ANSWER_IP_RATE_LIMIT_PER_MINUTE: '1' };

    expect((await post(app, db, '/api/invite/answer', {}, '', bindings)).status).toBe(400);
    const limited = await post(app, db, '/api/invite/answer', { token: 'bad', name: 'A子', votes: [] }, '', bindings);
    expect(limited.status).toBe(429);
    expect((await limited.json() as { message: string }).message).toBe('少し時間をおいてもう一度お試しください');
  });

  test('回答API: IPのフォールバック回数枠は独立したアプリ間で共有しない', async () => {
    const firstDb = makeDb();
    const secondDb = makeDb();
    const firstApp = testApp(firstDb);
    const secondApp = testApp(secondDb);
    const bindings = { ANSWER_IP_RATE_LIMIT_PER_MINUTE: '1' };
    const body = { token: 'bad', name: 'A子', votes: [] };

    expect((await post(firstApp, firstDb, '/api/invite/answer', body, '', bindings)).status).toBe(404);
    expect((await post(secondApp, secondDb, '/api/invite/answer', body, '', bindings)).status).toBe(404);
    expect((await post(firstApp, firstDb, '/api/invite/answer', body, '', bindings)).status).toBe(429);
  });

  test('回答API: bindingがない環境ではフォールバック上限を設定できる', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { token } = await setupPoll(app, db, host);
    const invite = await post(app, db, '/api/invite', { token });
    const { poll } = await invite.json() as { poll: { candidates: { id: string }[] } };
    const cookie = await guest(app, db);
    const bindings = { ANSWER_RESPONDENT_RATE_LIMIT_PER_MINUTE: '1' };
    const body = { token, name: 'A子', votes: [{ candidateId: poll.candidates[0]!.id, value: 'yes' }] };

    expect((await post(app, db, '/api/invite/answer', body, cookie, bindings)).status).toBe(200);
    const limited = await post(app, db, '/api/invite/answer', body, cookie, bindings);
    expect(limited.status).toBe(429);
    expect((await limited.json() as { message: string }).message).toBe('少し時間をおいてもう一度お試しください');
  });
});
