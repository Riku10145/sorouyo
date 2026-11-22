import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { voteSchema } from '../shared/model';
import { can, type PollTarget, type Subject } from '../shared/permissions';
import { getCookie } from 'hono/cookie';
import {
  GUEST_COOKIE, authDeps, checkOrigin, ensureGuest, resolveUser, verifyGuestId,
  type AuthDeps, type AuthEnv, type GetAuthDeps,
} from './auth';

export interface DataEnv extends AuthEnv {
  DB: D1Database;
}

type C = Context<{ Bindings: DataEnv }>;

const now = () => new Date().toISOString();

/** 回答を受け付ける条件（service-design.md: 受付中かどうかをSQLの条件に含める）。 */
const OPEN_WHERE = `status = 'open' AND (deadline_at IS NULL OR deadline_at > ?)`;

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

const newToken = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

// --- DB行 -------------------------------------------------------------------

interface GroupRow { id: string; name: string; color: string | null }
interface MemberRow { group_id: string; user_id: string; role: 'admin' | 'member' }
interface PollRow {
  id: string; group_id: string; creator_id: string; title: string;
  deadline_at: string | null; status: 'open' | 'confirmed';
  confirmed_candidate_id: string | null; created_at: string;
}
interface CandidateRow { id: string; poll_id: string; position: number; date: string; start_time: string | null }
interface AnswerRow {
  id: string; poll_id: string; respondent_key: string; user_id: string | null;
  guest_id: string | null; display_name: string; comment: string | null;
  created_at: string; updated_at: string;
}
interface VoteRow { answer_id: string; candidate_id: string; value: 'yes' | 'maybe' | 'no' }
interface EventRow {
  id: string; group_id: string; date: string; start_time: string | null;
  title: string; source_poll_id: string | null; created_at: string;
}
interface InviteRow {
  id: string; purpose: 'answer' | 'join'; poll_id: string | null; group_id: string | null;
  token_hash: string; expires_at: string | null; revoked_at: string | null;
}

const all = <T>(stmt: Promise<{ results: T[] }>) => stmt.then(r => r.results);
const get = <T>(stmt: Promise<T | null>) => stmt;

// --- 権限まわり -------------------------------------------------------------

type GetSubject = (c: C) => Promise<Subject>;

const makeSubjectOf = (getDeps: GetAuthDeps): GetSubject => async (c) => {
  const deps = getDeps(c as unknown as Parameters<GetAuthDeps>[0]);
  const user = deps ? await resolveUser(c, deps) : null;
  if (user) {
    await ensureUser(c, user);
    return { userId: user.id };
  }
  const guestId = await verifyGuestId(getCookie(c, GUEST_COOKIE), c.env);
  return guestId ? { guestId } : {};
};

async function ensureUser(c: C, user: { id: string; email: string; firstName?: string | null; lastName?: string | null }) {
  const name = [user.lastName, user.firstName].filter(Boolean).join(' ') || null;
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at`
  ).bind(user.id, user.email ?? null, name, now(), now()).run();
}

/** 調整の作成者・メンバー・管理者をまとめて PollTarget にする。 */
async function pollTarget(c: C, poll: PollRow, inviteValid: boolean): Promise<PollTarget> {
  const members = await all<MemberRow>(c.env.DB.prepare(
    `SELECT group_id, user_id, role FROM memberships WHERE group_id = ?`
  ).bind(poll.group_id).all());
  return {
    creatorId: poll.creator_id,
    memberIds: members.map(m => m.user_id),
    adminIds: members.filter(m => m.role === 'admin').map(m => m.user_id),
    inviteValid,
  };
}

const memberRole = async (c: C, groupId: string, userId: string) =>
  (await get<{ role: 'admin' | 'member' }>(c.env.DB.prepare(
    `SELECT role FROM memberships WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, userId).first()))?.role;

const findInvite = async (c: C, token: string) => {
  const hash = await sha256(token);
  const invite = await get<InviteRow>(c.env.DB.prepare(
    `SELECT id, purpose, poll_id, group_id, token_hash, expires_at, revoked_at FROM invites WHERE token_hash = ?`
  ).bind(hash).first());
  if (!invite || invite.revoked_at || (invite.expires_at && invite.expires_at <= now())) return undefined;
  return invite;
};

const newInvite = async (c: C, purpose: 'answer' | 'join', ref: { pollId?: string; groupId?: string }) => {
  const token = newToken();
  await c.env.DB.prepare(
    `INSERT INTO invites (id, purpose, poll_id, group_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), purpose, ref.pollId ?? null, ref.groupId ?? null, await sha256(token), now()).run();
  return token;
};

// --- 回答の書き込み ----------------------------------------------------------

/** 回答行の作成・更新と各票の差し替えを、受付中であることをSQL条件に含めて同一バッチで行う。 */
async function writeAnswer(
  c: C, pollId: string, key: string, ids: { userId?: string; guestId?: string },
  name: string, comment: string | null, votes: { candidateId: string; value: string }[],
) {
  const answerId = crypto.randomUUID();
  const at = now();
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO answers (id, poll_id, respondent_key, user_id, guest_id, display_name, comment, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM polls WHERE id = ? AND ${OPEN_WHERE})
       ON CONFLICT (poll_id, respondent_key) DO UPDATE SET
         display_name = excluded.display_name, comment = excluded.comment, updated_at = excluded.updated_at
       WHERE EXISTS (SELECT 1 FROM polls WHERE id = excluded.poll_id AND ${OPEN_WHERE})`
    ).bind(answerId, pollId, key, ids.userId ?? null, ids.guestId ?? null, name, comment, at, at, pollId, at, at),
    c.env.DB.prepare(
      `DELETE FROM votes WHERE answer_id = (SELECT id FROM answers WHERE poll_id = ? AND respondent_key = ?)
       AND EXISTS (SELECT 1 FROM polls WHERE id = ? AND ${OPEN_WHERE})`
    ).bind(pollId, key, pollId, at),
  ];
  for (const vote of votes) {
    stmts.push(c.env.DB.prepare(
      `INSERT INTO votes (answer_id, candidate_id, value)
       SELECT (SELECT id FROM answers WHERE poll_id = ? AND respondent_key = ?), c.id, ?
       FROM candidates c JOIN polls p ON p.id = c.poll_id
       WHERE c.id = ? AND c.poll_id = ? AND p.${OPEN_WHERE}`
    ).bind(pollId, key, vote.value, vote.candidateId, pollId, at));
  }
  await c.env.DB.batch(stmts);
  const saved = await get<AnswerRow>(c.env.DB.prepare(
    `SELECT * FROM answers WHERE poll_id = ? AND respondent_key = ?`
  ).bind(pollId, key).first());
  const savedVotes = await all<VoteRow>(c.env.DB.prepare(
    `SELECT v.* FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.poll_id = ? AND a.respondent_key = ?`
  ).bind(pollId, key).all());
  return { saved: saved ?? null, savedVotes };
}

// --- バリデーション ----------------------------------------------------------

const createGroupBody = z.object({ name: z.string().trim().min(1).max(40), color: z.string().trim().max(20).nullish() });
const joinBody = z.object({ token: z.string().min(1) });
const createPollBody = z.object({
  title: z.string().trim().min(1).max(60),
  deadlineAt: z.iso.datetime().nullish(),
  candidates: z.array(z.object({ date: z.iso.date(), time: z.string().regex(/^\d{2}:\d{2}$/).nullish() })).min(1).max(31),
});
const inviteBody = z.object({ token: z.string().min(1) });
const answerBody = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(30),
  comment: z.string().trim().max(100).nullish(),
  votes: z.array(z.object({ candidateId: z.string().min(1), value: voteSchema })).max(50),
});
const confirmBody = z.object({ candidateId: z.string().min(1) });
const eventBody = z.object({
  date: z.iso.date(), time: z.string().regex(/^\d{2}:\d{2}$/).nullish(), title: z.string().trim().min(1).max(60),
});
const monthQuery = /^\d{4}-\d{2}$/;

const json = <T extends z.ZodType>(schema: T) =>
  validator('json', (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json({ error: 'invalid_body' } as const, 400);
    return parsed.data;
  });

// --- ルート -----------------------------------------------------------------

export function buildDataRoutes(getDeps: GetAuthDeps) {
  const subjectOf = makeSubjectOf(getDeps);
  return new Hono<{ Bindings: DataEnv }>()

  // ログイン中の利用者が所属するグループ一覧（別ブラウザでも同じ結果が返る）
  .get('/groups', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groups = await all<GroupRow & { role: string }>(c.env.DB.prepare(
      `SELECT g.id, g.name, g.color, m.role FROM memberships m JOIN groups g ON g.id = m.group_id
       WHERE m.user_id = ? ORDER BY g.created_at`
    ).bind(subject.userId).all());
    return c.json({ groups } as const);
  })

  // グループ作成。作成者はadminとして所属する
  .post('/groups', json(createGroupBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const body = { data: c.req.valid('json') };
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO groups (id, name, color, created_at) VALUES (?, ?, ?, ?)`)
        .bind(id, body.data.name, body.data.color ?? null, now()),
      c.env.DB.prepare(`INSERT INTO memberships (group_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)`)
        .bind(id, subject.userId, now()),
    ]);
    return c.json({ group: { id, name: body.data.name, color: body.data.color ?? null, role: 'admin' } } as const, 201);
  })

  // グループ参加用リンクの発行（adminのみ）
  .post('/groups/:id/invites', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const token = await newInvite(c, 'join', { groupId });
    return c.json({ token } as const, 201);
  })

  // 参加リンクでログイン済み利用者が明示的に「参加」して所属を作る
  .post('/groups/join', json(joinBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const body = { data: c.req.valid('json') };
    const invite = await findInvite(c, body.data.token);
    if (!invite || invite.purpose !== 'join' || !invite.group_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    await c.env.DB.prepare(
      `INSERT INTO memberships (group_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)
       ON CONFLICT (group_id, user_id) DO NOTHING`
    ).bind(invite.group_id, subject.userId, now()).run();
    const group = await get<GroupRow>(c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(invite.group_id).first());
    return c.json({ group: { ...group!, role: 'member' } } as const, 201);
  })

  // 調整の作成（メンバー以上）。回答リンクを発行し、トークンはこのレスポンスにだけ含める
  .post('/groups/:id/polls', json(createPollBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    const role = await memberRole(c, groupId, subject.userId);
    if (!role) return c.json({ error: 'forbidden' } as const, 403);
    const body = { data: c.req.valid('json') };
    const pollId = crypto.randomUUID();
    const token = newToken();
    const stmts = [
      c.env.DB.prepare(
        `INSERT INTO polls (id, group_id, creator_id, title, deadline_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`
      ).bind(pollId, groupId, subject.userId, body.data.title, body.data.deadlineAt ?? null, now()),
      ...body.data.candidates.map((cand, i) =>
        c.env.DB.prepare(`INSERT INTO candidates (id, poll_id, position, date, start_time) VALUES (?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), pollId, i, cand.date, cand.time ?? null)),
      c.env.DB.prepare(`INSERT INTO invites (id, purpose, poll_id, token_hash, created_at) VALUES (?, 'answer', ?, ?, ?)`)
        .bind(crypto.randomUUID(), pollId, await sha256(token), now()),
    ];
    await c.env.DB.batch(stmts);
    return c.json({ poll: { id: pollId }, token } as const, 201);
  })

  // 回答リンクの再発行（メンバー以上）。既存リンクは無効化しない
  .post('/polls/:id/invite', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, poll.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    const token = await newInvite(c, 'answer', { pollId: poll.id });
    return c.json({ token } as const, 201);
  })

  // 調整の取得（メンバー以上）。ゲストの回答リンクではこの形は返さない
  .get('/polls/:id', async (c) => {
    const subject = await subjectOf(c);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'viewTally', target) && !can(subject, 'viewPoll', target)) {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const [group, candidates, answers, votes, host] = await Promise.all([
      get<GroupRow>(c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(poll.group_id).first()),
      all<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE poll_id = ? ORDER BY position`).bind(poll.id).all()),
      all<AnswerRow>(c.env.DB.prepare(`SELECT * FROM answers WHERE poll_id = ? ORDER BY created_at`).bind(poll.id).all()),
      all<VoteRow & { respondent_key: string }>(c.env.DB.prepare(
        `SELECT v.*, a.respondent_key FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.poll_id = ?`
      ).bind(poll.id).all()),
      get<{ display_name: string | null }>(c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(poll.creator_id).first()),
    ]);
    const votesBy = new Map<string, Record<string, string>>();
    for (const v of votes) (votesBy.get(v.respondent_key) ?? (votesBy.set(v.respondent_key, {}), votesBy.get(v.respondent_key)!))[v.candidate_id] = v.value;
    const myKey = subject.userId ? `u:${subject.userId}` : undefined;
    const tallyAllowed = can(subject, 'viewTally', target);
    return c.json({
      poll: {
        id: poll.id,
        title: poll.title,
        status: poll.status,
        deadlineAt: poll.deadline_at,
        confirmedCandidateId: poll.confirmed_candidate_id,
        group: group!,
        creatorId: poll.creator_id,
        hostName: host?.display_name ?? null,
        candidates: candidates.map(cand => ({ id: cand.id, date: cand.date, startTime: cand.start_time })),
        // 集計（回答者別の内訳）は作成者のみ。メンバーは自分の回答まで
        answers: answers.filter(a => tallyAllowed || a.respondent_key === myKey).map(a => ({
          id: a.id,
          name: a.display_name,
          comment: a.comment,
          own: a.respondent_key === myKey,
          votes: votesBy.get(a.respondent_key) ?? {},
          createdAt: a.created_at,
        })),
      },
    } as const);
  })

  // 候補日の確定（作成者のみ）。未確定からの条件付き更新と予定の生成を同一バッチで行う
  .post('/polls/:id/confirm', json(confirmBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'confirmPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    const body = { data: c.req.valid('json') };
    const { candidateId } = body.data;
    const candidate = await get<CandidateRow>(c.env.DB.prepare(
      `SELECT * FROM candidates WHERE id = ? AND poll_id = ?`
    ).bind(candidateId, poll.id).first());
    if (!candidate) return c.json({ error: 'invalid_body' } as const, 400);

    if (poll.status === 'confirmed') {
      // 同一候補の再送は既存結果を返し、別候補は競合（service-design.md 手順4）
      if (poll.confirmed_candidate_id === candidateId) {
        const event = await get<EventRow>(c.env.DB.prepare(`SELECT * FROM events WHERE source_poll_id = ?`).bind(poll.id).first());
        return c.json({ poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId }, event: event ?? null } as const, 200);
      }
      return c.json({ error: 'conflict', confirmedCandidateId: poll.confirmed_candidate_id } as const, 409);
    }

    const eventId = crypto.randomUUID();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE polls SET status = 'confirmed', confirmed_candidate_id = ? WHERE id = ? AND status = 'open'`
      ).bind(candidateId, poll.id),
      c.env.DB.prepare(
        `INSERT INTO events (id, group_id, date, start_time, title, source_poll_id, created_at)
         SELECT ?, p.group_id, c.date, c.start_time, p.title, p.id, ?
         FROM polls p JOIN candidates c ON c.id = p.confirmed_candidate_id
         WHERE p.id = ? AND p.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM events WHERE source_poll_id = p.id)`
      ).bind(eventId, now(), poll.id),
    ]);
    if (!results[0]!.meta.changes) {
      // 同時確定: 先に成立した方を正本として結果を返す
      const latest = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(poll.id).first());
      if (latest?.confirmed_candidate_id === candidateId) {
        const event = await get<EventRow>(c.env.DB.prepare(`SELECT * FROM events WHERE source_poll_id = ?`).bind(poll.id).first());
        return c.json({ poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId }, event: event ?? null } as const, 200);
      }
      return c.json({ error: 'conflict', confirmedCandidateId: latest?.confirmed_candidate_id ?? null } as const, 409);
    }
    const event = await get<EventRow>(c.env.DB.prepare(`SELECT * FROM events WHERE source_poll_id = ?`).bind(poll.id).first());
    return c.json({ poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId }, event: event ?? null } as const, 200);
  })

  // 確定の取り消し（作成者のみ）。調整の状態変更と予定の削除を同一バッチで行う
  .post('/polls/:id/unconfirm', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first());
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'confirmPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE polls SET status = 'open', confirmed_candidate_id = NULL WHERE id = ? AND status = 'confirmed'`).bind(poll.id),
      c.env.DB.prepare(`DELETE FROM events WHERE source_poll_id = ?`).bind(poll.id),
    ]);
    return c.json({ poll: { id: poll.id, status: 'open' } } as const, 200);
  })

  // 予定の追加（メンバー以上）
  .post('/groups/:id/events', json(eventBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if (!(await memberRole(c, groupId, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    const body = { data: c.req.valid('json') };
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO events (id, group_id, date, start_time, title, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, groupId, body.data.date, body.data.time ?? null, body.data.title, now()).run();
    return c.json({ event: { id } } as const, 201);
  })

  // 所属グループの月カレンダー（メンバー以外は自分の予定を返さない）
  .get('/calendar', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const month = c.req.query('month') ?? '';
    if (!monthQuery.test(month)) return c.json({ error: 'invalid_query' } as const, 400);
    const events = await all<EventRow & { group_name: string; group_color: string | null }>(c.env.DB.prepare(
      `SELECT e.*, g.name AS group_name, g.color AS group_color FROM events e
       JOIN groups g ON g.id = e.group_id
       JOIN memberships m ON m.group_id = e.group_id AND m.user_id = ?
       WHERE e.date >= ? AND e.date < ?
       ORDER BY e.date, e.start_time`
    ).bind(subject.userId, `${month}-01`, `${month}-32`).all());
    return c.json({
      events: events.map(e => ({
        id: e.id, date: e.date, startTime: e.start_time, title: e.title,
        group: { id: e.group_id, name: e.group_name, color: e.group_color },
        sourcePollId: e.source_poll_id,
      })),
    } as const);
  })

  // --- ゲスト（回答リンク） ---------------------------------------------------

  // 招待トークンで調整を開く。返すのはその調整・自分の回答・確定日だけ（メンバー一覧や他の予定は出さない）
  .post('/invite', json(inviteBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = { data: c.req.valid('json') };
    const invite = await findInvite(c, body.data.token);
    if (!invite || invite.purpose !== 'answer' || !invite.poll_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(invite.poll_id).first());
    if (!poll) return c.json({ error: 'invite_invalid' } as const, 404);
    const subject = await subjectOf(c);
    let ownAnswer: { name: string; comment: string | null; votes: Record<string, string> } | null = null;
    const key = subject.userId ? `u:${subject.userId}` : subject.guestId ? `g:${subject.guestId}` : undefined;
    if (key) {
      const row = await get<AnswerRow>(c.env.DB.prepare(
        `SELECT * FROM answers WHERE poll_id = ? AND respondent_key = ?`
      ).bind(poll.id, key).first());
      if (row) {
        const votes = await all<VoteRow>(c.env.DB.prepare(`SELECT * FROM votes WHERE answer_id = ?`).bind(row.id).all());
        ownAnswer = { name: row.display_name, comment: row.comment, votes: Object.fromEntries(votes.map(v => [v.candidate_id, v.value])) };
      }
    }
    const [group, candidates, confirmed, host] = await Promise.all([
      get<GroupRow>(c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(poll.group_id).first()),
      all<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE poll_id = ? ORDER BY position`).bind(poll.id).all()),
      poll.confirmed_candidate_id
        ? get<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE id = ?`).bind(poll.confirmed_candidate_id).first())
        : Promise.resolve(null),
      get<{ display_name: string | null }>(c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(poll.creator_id).first()),
    ]);
    const accepting = poll.status === 'open' && (!poll.deadline_at || poll.deadline_at > now());
    return c.json({
      poll: {
        id: poll.id,
        title: poll.title,
        status: poll.status,
        accepting,
        deadlineAt: poll.deadline_at,
        group: group!,
        host: host?.display_name ?? null,
        candidates: candidates.map(cand => ({ id: cand.id, date: cand.date, startTime: cand.start_time })),
        confirmed: confirmed ? { date: confirmed.date, startTime: confirmed.start_time } : null,
        ownAnswer,
      },
    } as const);
  })

  // ゲスト・メンバーの回答（○△×）。同一送信の再試行は (poll_id, respondent_key) で1件に統合
  .post('/invite/answer', json(answerBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = { data: c.req.valid('json') };
    const invite = await findInvite(c, body.data.token);
    if (!invite || invite.purpose !== 'answer' || !invite.poll_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const poll = await get<PollRow>(c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(invite.poll_id).first());
    if (!poll) return c.json({ error: 'invite_invalid' } as const, 404);

    const subject = await subjectOf(c);
    const target = await pollTarget(c, poll, true);
    if (!can(subject, 'answerPoll', target)) return c.json({ error: 'forbidden' } as const, 403);

    const ids = subject.userId ? { userId: subject.userId } : { guestId: await ensureGuest(c) };
    const key = ids.userId ? `u:${ids.userId}` : `g:${ids.guestId}`;

    // 対象調整に属する候補だけを受理する
    const validIds = new Set(
      (await all<{ id: string }>(c.env.DB.prepare(`SELECT id FROM candidates WHERE poll_id = ?`).bind(poll.id).all())).map(row => row.id)
    );
    const votes = body.data.votes.filter(v => validIds.has(v.candidateId));
    if (!votes.length) return c.json({ error: 'invalid_body' } as const, 400);

    const { saved, savedVotes } = await writeAnswer(c, poll.id, key, ids, body.data.name, body.data.comment ?? null, votes);
    if (!saved || (votes.length && !savedVotes.length)) {
      const accepting = poll.status === 'open' && (!poll.deadline_at || poll.deadline_at > now());
      if (!accepting) return c.json({ error: 'closed' } as const, 410);
      return c.json({ error: 'conflict' } as const, 409);
    }
    return c.json({
      answer: {
        id: saved.id,
        name: saved.display_name,
        comment: saved.comment,
        votes: Object.fromEntries(savedVotes.map(v => [v.candidate_id, v.value])),
      },
    } as const, 200);
  });
}

export const dataRoutes = buildDataRoutes(authDeps);
