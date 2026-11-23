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

// --- D1 を node:sqlite でシムする（migrations/*.sql をそのまま適用） ---

function makeDb(): D1Database {
  const db = new DatabaseSync(':memory:');
  // 新しい migration を足したらここにも列挙する
  for (const file of ['0001_init.sql', '0002_invite_creator.sql']) {
    db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  }
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

  test('回答リンクの再発行は旧リンクを同一バッチで失効させ、新リンクだけが有効になる', async () => {
    const db = makeDb();
    const app = testApp(db);
    const host = await login(app, db, 'code_host');
    const { pollId, token } = await setupPoll(app, db, host);

    // 失効UPDATEと新規INSERTが同一batchで出ることを確認（別トランザクションだと原子性が保てない）
    const batches: string[][] = [];
    const origBatch = db.batch.bind(db);
    db.batch = async (stmts) => {
      batches.push(stmts.map((s) => (s as unknown as { sql: string }).sql));
      return origBatch(stmts);
    };
    const reissued = await req(app, db, `/api/polls/${pollId}/invite`, { method: 'POST', headers: { cookie: host } });
    expect(reissued.status).toBe(201);
    const { token: token2 } = await reissued.json() as { token: string };
    expect(token2).not.toBe(token);
    const reissue = batches.find((sqls) => sqls.some((s) => s.includes('INSERT INTO invites')));
    expect(reissue?.some((s) => s.includes('UPDATE invites SET revoked_at'))).toBe(true);

    // 旧リンクは閲覧も送信も拒否される
    expect((await post(app, db, '/api/invite', { token })).status).toBe(404);
    const invite = await post(app, db, '/api/invite', { token: token2 });
    const candId = (await invite.json() as { poll: { candidates: { id: string }[] } }).poll.candidates[0]!.id;
    expect((await post(app, db, '/api/invite/answer', {
      token, name: '旧リンク', votes: [{ candidateId: candId, value: 'yes' }],
    })).status).toBe(404);
    // 新リンクは従来どおり使える
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

    // 取消すると予定が消える
    await post(app, db, `/api/polls/${pollId}/unconfirm`, {}, host);
    const cal2 = await req(app, db, '/api/calendar?month=2026-04', { headers: { cookie: member } });
    expect((await cal2.json() as { events: unknown[] }).events).toHaveLength(0);
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
});
