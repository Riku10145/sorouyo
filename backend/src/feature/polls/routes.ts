import { Hono } from 'hono';
import { createPollBody, confirmBody, unconfirmBody, updatePollBody } from '../../../../shared/schema';
import { checkOrigin } from '../../auth';
import type { DataEnv } from '../../context';
import { type GetSubject, pollTarget, memberRole } from '../../lib/access';
import { type GroupRow, type PollRow, type CandidateRow, type AnswerRow, type VoteRow, type EventRow, all } from '../../lib/db';
import { sha256, newToken } from '../../lib/invites';
import { can } from '../../lib/permissions';
import { isPollAccepting } from '../../lib/polls';
import { now } from '../../lib/time';
import { json } from '../../validation';
import { newAnswerInvite } from './invites';

export function pollsRoutes(subjectOf: GetSubject) {
  return new Hono<{ Bindings: DataEnv }>()
  // 調整の作成（メンバー以上）。回答リンクを発行し、トークンはこのレスポンスにだけ含める
  .post('/groups/:id/polls', json(createPollBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    const role = await memberRole(c, groupId, subject.userId);
    if (!role) return c.json({ error: 'forbidden' } as const, 403);
    const body = c.req.valid('json');
    const pollId = crypto.randomUUID();
    const token = newToken();
    const stmts = [
      c.env.DB.prepare(
        `INSERT INTO polls (id, group_id, creator_id, title, deadline_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`
      // 締切はミリ秒つきISOに正規化して保存し、 ACCEPTING_POLL_WHERE の文字列比較と形式を揃える
      ).bind(pollId, groupId, subject.userId, body.title, body.deadlineAt ? new Date(body.deadlineAt).toISOString() : null, now()),
      ...body.candidates.map((cand, i) =>
        c.env.DB.prepare(`INSERT INTO candidates (id, poll_id, position, date, start_time) VALUES (?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), pollId, i, cand.date, cand.time ?? null)),
      c.env.DB.prepare(`INSERT INTO invites (id, purpose, poll_id, token_hash, created_by, created_at) VALUES (?, 'answer', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), pollId, await sha256(token), subject.userId, now()),
    ];
    await c.env.DB.batch(stmts);
    return c.json({ poll: { id: pollId }, token } as const, 201);
  })

  // 回答リンクの再発行（メンバー以上）。漏えい時に使えるよう、旧リンクは同一バッチで失効させる
  .post('/polls/:id/invite', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first<PollRow>();
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, poll.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    // 回答リンクはベアラートークン。再発行で既存リンクを失効させると、
    // 主催がコピーするたびに共有済みリンクが死ぬため、旧リンクはそのまま有効にしておく
    const token = await newAnswerInvite(c, poll.id, subject.userId);
    return c.json({ token } as const, 201);
  })

  // 所属グループの調整一覧（メンバー以上）。状態・候補数・回答数・確定日を含める
  .get('/polls', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const polls = await all<PollRow & { group_name: string; group_color: string | null; candidate_count: number; answer_count: number; confirmed_date: string | null; confirmed_time: string | null }>(c.env.DB.prepare(
      `SELECT p.*, g.name AS group_name, g.color AS group_color, cc.date AS confirmed_date, cc.start_time AS confirmed_time,
              (SELECT COUNT(*) FROM candidates cd WHERE cd.poll_id = p.id) AS candidate_count,
              (SELECT COUNT(DISTINCT v.answer_id) FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.poll_id = p.id) AS answer_count
       FROM polls p
       JOIN groups g ON g.id = p.group_id
       JOIN memberships m ON m.group_id = p.group_id AND m.user_id = ?
       LEFT JOIN candidates cc ON cc.id = p.confirmed_candidate_id
       ORDER BY p.created_at DESC`
    ).bind(subject.userId).all());
    const at = now();
    return c.json({
      polls: polls.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        deadlineAt: p.deadline_at,
        accepting: isPollAccepting(p, at),
        group: { id: p.group_id, name: p.group_name, color: p.group_color },
        creator: p.creator_id === subject.userId,
        candidatesCount: p.candidate_count,
        answersCount: p.answer_count,
        confirmed: p.confirmed_date ? { date: p.confirmed_date, startTime: p.confirmed_time } : null,
      })),
    } as const);
  })

  // 調整の取得（メンバー以上）。ゲストの回答リンクではこの形は返さない。確定候補と予定IDは1つの読み取りで取り、再確定の途中でずれないようにする
  .get('/polls/:id', async (c) => {
    const subject = await subjectOf(c);
    // 未ログインは401としてクライアントにログイン導線を出させる（ゲストは回答リンク経由のみ）
    if (!subject.userId) return c.json({ error: 'unauthorized' } as const, 401);
    const poll = await c.env.DB.prepare(
      `SELECT p.*, (SELECT e.id FROM events e WHERE e.source_poll_id = p.id) AS confirmed_event_id FROM polls p WHERE p.id = ?`
    ).bind(c.req.param('id')).first<PollRow & { confirmed_event_id: string | null }>();
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'viewTally', target) && !can(subject, 'viewPoll', target)) {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const myKey = subject.userId ? `u:${subject.userId}` : undefined;
    const tallyAllowed = can(subject, 'viewTally', target);
    const [group, candidates, answers, votes, host, memberRows] = await Promise.all([
      c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(poll.group_id).first<GroupRow>(),
      all<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE poll_id = ? ORDER BY position`).bind(poll.id).all()),
      all<AnswerRow>(c.env.DB.prepare(`SELECT * FROM answers WHERE poll_id = ? ORDER BY created_at`).bind(poll.id).all()),
      all<VoteRow & { respondent_key: string }>(c.env.DB.prepare(
        `SELECT v.*, a.respondent_key FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.poll_id = ?`
      ).bind(poll.id).all()),
      c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(poll.creator_id).first<{ display_name: string | null }>(),
      // 催促対象の分け方（#7）は作成者だけに返す。メンバー一覧はゲスト・一般メンバーに出さない
      tallyAllowed
        ? all<{ user_id: string; display_name: string | null; email: string | null; answered: number }>(c.env.DB.prepare(
            `SELECT m.user_id, u.display_name, u.email,
                    EXISTS(SELECT 1 FROM answers a WHERE a.poll_id = ? AND a.respondent_key = 'u:' || m.user_id) AS answered
             FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.created_at`
          ).bind(poll.id, poll.group_id).all())
        : Promise.resolve([]),
    ]);
    const votesBy = new Map<string, Record<string, string>>();
    for (const v of votes) {
      let entry = votesBy.get(v.respondent_key);
      if (!entry) votesBy.set(v.respondent_key, entry = {});
      entry[v.candidate_id] = v.value;
    }
    return c.json({
      poll: {
        id: poll.id,
        title: poll.title,
        status: poll.status,
        deadlineAt: poll.deadline_at,
        confirmedCandidateId: poll.confirmed_candidate_id,
        confirmedEventId: poll.confirmed_event_id,
        editVersion: poll.edit_version,
        reopenPending: poll.reopen_pending === 1,
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
        // #7: 催促対象の分類。作成者にだけ返し、回答済みかどうかを回答行の有無で判定する
        members: memberRows.map(m => ({
          id: m.user_id,
          name: m.display_name ?? m.email ?? '名無し',
          answered: Boolean(m.answered),
        })),
      },
    } as const);
  })

  // 受付中の調整の編集（作成者のみ）。候補の日時変更は削除＋追加扱いで、その候補の票だけ消す
  .patch('/polls/:id', json(updatePollBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first<PollRow>();
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'editPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    if (poll.status !== 'open') return c.json({ error: 'already_confirmed' } as const, 409);
    const body = c.req.valid('json');
    const current = await all<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE poll_id = ? ORDER BY position`).bind(poll.id).all());
    const currentById = new Map(current.map(row => [row.id, row]));
    const used = new Set<string>();
    const rows = body.candidates.map((input, index) => {
      const existing = input.id && !used.has(input.id) ? currentById.get(input.id) : undefined;
      const unchanged = existing && existing.date === input.date && (existing.start_time ?? null) === (input.time ?? null);
      const id = unchanged ? existing.id : crypto.randomUUID();
      used.add(id);
      return { id, position: index, date: input.date, time: input.time ?? null, unchanged: !!unchanged };
    });
    if (new Set(rows.map(row => `${row.date}\0${row.time ?? ''}`)).size !== rows.length) {
      return c.json({ error: 'invalid_body' } as const, 400);
    }
    const kept = new Set(rows.filter(row => row.unchanged).map(row => row.id));
    const removed = current.filter(row => !kept.has(row.id)).map(row => row.id);
    const deadlineAt = body.deadlineAt ? new Date(body.deadlineAt).toISOString() : null;
    const clearsReopen = deadlineAt !== null && new Date(deadlineAt).getTime() > Date.now();
    // 確定取消からの再調整では、未来の締切を保存するまで受付を再開しない。空欄や過去時刻のまま成功にはしない
    if (poll.reopen_pending && !clearsReopen) return c.json({ error: 'reopen_deadline_required' } as const, 400);
    const version = body.editVersion;
    const editGuard = `EXISTS (SELECT 1 FROM polls WHERE id = ? AND status = 'open' AND edit_version = ?)`;
    const stmts = [
      c.env.DB.prepare(
        `UPDATE polls SET title = ?, deadline_at = ?, reopen_pending = ?
         WHERE id = ? AND status = 'open' AND edit_version = ?`
      ).bind(body.title, deadlineAt, clearsReopen ? 0 : poll.reopen_pending, poll.id, version),
      // UNIQUE(poll_id, position) の即時制約を避けるため、再配置の間は既存候補を一時的に大きな位置へ退避する
      ...current.map(row => c.env.DB.prepare(`UPDATE candidates SET position = ? WHERE id = ? AND ${editGuard}`)
        .bind(row.position + 1000, row.id, poll.id, version)),
      ...removed.map(id => c.env.DB.prepare(`DELETE FROM votes WHERE candidate_id = ? AND ${editGuard}`)
        .bind(id, poll.id, version)),
      ...removed.map(id => c.env.DB.prepare(`DELETE FROM candidates WHERE id = ? AND ${editGuard}`)
        .bind(id, poll.id, version)),
      ...rows.filter(row => !row.unchanged).map(row => c.env.DB.prepare(
        `INSERT INTO candidates (id, poll_id, position, date, start_time) SELECT ?, ?, ?, ?, ? WHERE ${editGuard}`
      ).bind(row.id, poll.id, row.position, row.date, row.time, poll.id, version)),
      ...rows.filter(row => row.unchanged).map(row => c.env.DB.prepare(`UPDATE candidates SET position = ? WHERE id = ? AND ${editGuard}`)
        .bind(row.position, row.id, poll.id, version)),
      c.env.DB.prepare(`UPDATE polls SET edit_version = edit_version + 1 WHERE id = ? AND status = 'open' AND edit_version = ?`)
        .bind(poll.id, version),
    ];
    const results = await c.env.DB.batch(stmts);
    if (!results[results.length - 1]!.meta.changes) return c.json({ error: 'conflict' } as const, 409);
    return c.json({ poll: { id: poll.id, status: 'open' } } as const);
  })

  // 受付中の調整の削除（作成者のみ）。確定済みは先に確定取消を求める
  .delete('/polls/:id', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first<PollRow>();
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'editPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    if (poll.status !== 'open') return c.json({ error: 'already_confirmed' } as const, 409);
    const inAnswers = `SELECT id FROM answers WHERE poll_id = ?`;
    const openPoll = `EXISTS (SELECT 1 FROM polls WHERE id = ? AND status = 'open')`;
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM votes WHERE (answer_id IN (${inAnswers}) OR candidate_id IN (SELECT id FROM candidates WHERE poll_id = ?)) AND ${openPoll}`).bind(poll.id, poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM answers WHERE poll_id = ? AND ${openPoll}`).bind(poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM candidates WHERE poll_id = ? AND ${openPoll}`).bind(poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM invites WHERE poll_id = ? AND ${openPoll}`).bind(poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM events WHERE source_poll_id = ? AND ${openPoll}`).bind(poll.id, poll.id),
      c.env.DB.prepare(`DELETE FROM polls WHERE id = ? AND status = 'open'`).bind(poll.id),
    ]);
    if (!results[results.length - 1]!.meta.changes) return c.json({ error: 'already_confirmed' } as const, 409);
    return c.body(null, 204);
  })

  // 候補日の確定（作成者のみ）。未確定からの条件付き更新と予定の生成を同一バッチで行う
  .post('/polls/:id/confirm', json(confirmBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first<PollRow>();
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'confirmPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    const body = c.req.valid('json');
    const { candidateId } = body;
    const candidate = await c.env.DB.prepare(
      `SELECT * FROM candidates WHERE id = ? AND poll_id = ?`
    ).bind(candidateId, poll.id).first<CandidateRow>();
    if (!candidate) return c.json({ error: 'invalid_body' } as const, 400);

    if (poll.status === 'confirmed') {
      // 同一候補の再送は既存結果を返し、別候補は競合（service-design.md 手順4）
      if (poll.confirmed_candidate_id === candidateId) {
        const event = await c.env.DB.prepare(`SELECT id, date, start_time FROM events WHERE source_poll_id = ?`).bind(poll.id).first<EventRow>();
        return c.json({ poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId }, event: event ?? null } as const, 200);
      }
      return c.json({ error: 'conflict', confirmedCandidateId: poll.confirmed_candidate_id } as const, 409);
    }

    const eventId = crypto.randomUUID();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE polls SET status = 'confirmed', confirmed_candidate_id = ?, reopen_pending = 0, edit_version = edit_version + 1
         WHERE id = ? AND status = 'open' AND EXISTS (SELECT 1 FROM candidates WHERE id = ? AND poll_id = ?)`
      ).bind(candidateId, poll.id, candidateId, poll.id),
      c.env.DB.prepare(
        `INSERT INTO events (id, group_id, date, start_time, title, source_poll_id, created_at)
         SELECT ?, p.group_id, c.date, c.start_time, p.title, p.id, ?
         FROM polls p JOIN candidates c ON c.id = p.confirmed_candidate_id
         WHERE p.id = ? AND p.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM events WHERE source_poll_id = p.id)`
      ).bind(eventId, now(), poll.id),
    ]);
    if (!results[0]!.meta.changes) {
      // 同時確定: 先に成立した方を正本として結果を返す
      const latest = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(poll.id).first<PollRow>();
      if (latest?.confirmed_candidate_id === candidateId) {
        const event = await c.env.DB.prepare(`SELECT id, date, start_time FROM events WHERE source_poll_id = ?`).bind(poll.id).first<EventRow>();
        return c.json({ poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId }, event: event ?? null } as const, 200);
      }
      return c.json({ error: 'conflict', confirmedCandidateId: latest?.confirmed_candidate_id ?? null } as const, 409);
    }
    // バッチで生成した予定IDをそのまま返し、直後の再確定で別の予定IDを古い画面へ返さないようにする
    return c.json({
      poll: { id: poll.id, status: 'confirmed', confirmedCandidateId: candidateId },
      event: { id: eventId, date: candidate.date, start_time: candidate.start_time },
    } as const, 200);
  })

  // 確定の取り消し（作成者のみ）。古い確定画面からの取消が新しい確定を消さないよう、対象の予定IDを条件にする
  .post('/polls/:id/unconfirm', json(unconfirmBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const poll = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(c.req.param('id')).first<PollRow>();
    if (!poll) return c.json({ error: 'not_found' } as const, 404);
    const target = await pollTarget(c, poll, false);
    if (!can(subject, 'confirmPoll', target)) return c.json({ error: 'forbidden' } as const, 403);
    const { eventId } = c.req.valid('json');
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE polls SET status = 'open', confirmed_candidate_id = NULL, deadline_at = ?, reopen_pending = 1, edit_version = edit_version + 1
         WHERE id = ? AND status = 'confirmed'
           AND EXISTS (SELECT 1 FROM events WHERE source_poll_id = ? AND id = ?)`
      ).bind(now(), poll.id, poll.id, eventId),
      c.env.DB.prepare(
        `DELETE FROM events WHERE source_poll_id = ? AND id = ? AND EXISTS (
           SELECT 1 FROM polls WHERE id = ? AND status = 'open' AND confirmed_candidate_id IS NULL
         )`
      ).bind(poll.id, eventId, poll.id),
    ]);
    if (!results[0]!.meta.changes) {
      const latest = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(poll.id).first<PollRow>();
      if (latest?.status !== 'open') return c.json({ error: 'conflict' } as const, 409);
    }
    return c.json({ poll: { id: poll.id, status: 'open' } } as const, 200);
  });
}
