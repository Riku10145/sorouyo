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
import { buildDataRoutes, type DataEnv } from './data';

// --- D1 を node:sqlite でシムする（migrations/0001_init.sql をそのまま適用） ---

function makeDb(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
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
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

// --- WorkOS のフェイク（code_XX -> user_XX の対応だけ見る） ------------------

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

const env = (db: D1Database): DataEnv => ({ DB: db, WORKOS_COOKIE_PASSWORD: 'x'.repeat(40) });

const req = (app: ReturnType<typeof testApp>, db: D1Database, path: string, init?: RequestInit) =>
  app.request(`https://app.example${path}`, init, env(db));

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

const post = (app: ReturnType<typeof testApp>, db: D1Database, path: string, body: unknown, cookie = '') =>
  req(app, db, path, {
    method: 'POST',
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

  test('回答リンクの範囲は対象の調整と自分の回答だけ（他グループの予定・主催者操作は拒否）', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const other = await login(app, db, 'code_other');
    const { groupId, pollId, token } = await setupPoll(app, db, host);
    const b = await guest(app, db);

    // 他グループの予定は見えない
    expect((await req(app, db, '/api/calendar', { headers: { cookie: b } })).status).toBe(401);
    expect((await req(app, db, `/api/polls/${pollId}`, { headers: { cookie: b } })).status).toBe(403);
    // 主催者操作は拒否（ゲスト/別アカウントどちらも）
    const confirmBody = JSON.stringify({ candidateId: 'x' });
    for (const cookie of [b, other]) {
      // 未ログインは401、ログイン済みの非メンバーは403（どちらも拒否）
      expect([401, 403]).toContain((await req(app, db, `/api/polls/${pollId}/confirm`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: confirmBody })).status);
      expect([401, 403]).toContain((await req(app, db, `/api/polls/${pollId}/invite`, { method: 'POST', headers: { cookie } })).status);
      expect([401, 403]).toContain((await req(app, db, `/api/groups/${groupId}/invites`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status);
    }
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

    // 取消すると予定が消える
    await post(app, db, `/api/polls/${pollId}/unconfirm`, {}, host);
    const cal2 = await req(app, db, '/api/calendar?month=2026-04', { headers: { cookie: member } });
    expect((await cal2.json() as { events: unknown[] }).events).toHaveLength(0);
  });
});
