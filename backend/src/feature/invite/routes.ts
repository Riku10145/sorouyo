import { Hono, type Next } from 'hono';
import { inviteBody, answerBody } from '../../../../shared/schema';
import { recordAnalytics } from '../../analytics';
import { checkOrigin, ensureGuest } from '../../auth';
import type { DataEnv, C } from '../../context';
import { type GetSubject, pollTarget } from '../../lib/access';
import { type GroupRow, type PollRow, type CandidateRow, type AnswerRow, type VoteRow, all } from '../../lib/db';
import { findInvite } from '../../lib/invites';
import { can } from '../../lib/permissions';
import { isPollAccepting } from '../../lib/polls';
import { json } from '../../validation';
import { writeAnswer } from './answers';
import { rateLimited, makeRateLimiter, clientIp } from './rateLimit';

export function inviteRoutes(subjectOf: GetSubject) {
  const limitAnswer = makeRateLimiter();
  const limitInviteMeasure = makeRateLimiter();
  /** 送信元IP制限は入力検証より先に行い、不正な本文の連投もカウントする。 */
  const limitAnswerIp = async (c: C, next: Next) => {
    if (!await limitAnswer(
      c.env.ANSWER_IP_RATE_LIMIT,
      `answer-ip:${clientIp(c)}`,
      c.env.ANSWER_IP_RATE_LIMIT_PER_MINUTE,
      60,
    )) return rateLimited(c);
    await next();
  };
  const limitInviteMeasureIp = async (c: C, next: Next) => {
    if (!await limitInviteMeasure(
      c.env.INVITE_MEASURE_IP_RATE_LIMIT,
      `invite-measure-ip:${clientIp(c)}`,
      c.env.INVITE_MEASURE_IP_RATE_LIMIT_PER_MINUTE,
      30,
    )) return rateLimited(c);
    await next();
  };
  return new Hono<{ Bindings: DataEnv }>()
  // 回答完了画面の「自分のグループを作る」クリック。遷移を止めず、匿名計測だけを行う
  .post('/invite/usage-start-click', limitInviteMeasureIp, json(inviteBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = c.req.valid('json');
    const invite = await findInvite(c, body.token);
    if (!invite || invite.purpose !== 'answer' || !invite.poll_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const visitorId = await ensureGuest(c);
    await recordAnalytics(c, 'usage_start_click', invite.id, invite.poll_id, visitorId);
    return c.body(null, 204);
  })

  // 招待トークンで調整を開く。返すのはその調整・自分の回答・確定日だけ（メンバー一覧や他の予定は出さない）
  .post('/invite', limitInviteMeasureIp, json(inviteBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = c.req.valid('json');
    const invite = await findInvite(c, body.token);
    if (!invite || invite.purpose !== 'answer' || !invite.poll_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const poll = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(invite.poll_id).first<PollRow>();
    if (!poll) return c.json({ error: 'invite_invalid' } as const, 404);
    const visitVisitorId = await ensureGuest(c);
    await recordAnalytics(c, 'invite_visit', invite.id, poll.id, visitVisitorId);
    const subject = await subjectOf(c);
    let ownAnswer: { name: string; comment: string | null; votes: Record<string, string> } | null = null;
    const key = subject.userId ? `u:${subject.userId}` : subject.guestId ? `g:${subject.guestId}` : undefined;
    if (key) {
      const row = await c.env.DB.prepare(
        `SELECT * FROM answers WHERE poll_id = ? AND respondent_key = ?`
      ).bind(poll.id, key).first<AnswerRow>();
      if (row) {
        const votes = await all<VoteRow>(c.env.DB.prepare(`SELECT * FROM votes WHERE answer_id = ?`).bind(row.id).all());
        ownAnswer = { name: row.display_name, comment: row.comment, votes: Object.fromEntries(votes.map(v => [v.candidate_id, v.value])) };
      }
    }
    const [group, candidates, confirmed, host] = await Promise.all([
      c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(poll.group_id).first<GroupRow>(),
      all<CandidateRow>(c.env.DB.prepare(`SELECT * FROM candidates WHERE poll_id = ? ORDER BY position`).bind(poll.id).all()),
      poll.confirmed_candidate_id
        ? c.env.DB.prepare(`SELECT * FROM candidates WHERE id = ?`).bind(poll.confirmed_candidate_id).first<CandidateRow>()
        : Promise.resolve(null),
      c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(poll.creator_id).first<{ display_name: string | null }>(),
    ]);
    const accepting = isPollAccepting(poll);
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
  .post('/invite/answer', limitAnswerIp, json(answerBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = c.req.valid('json');
    const invite = await findInvite(c, body.token);
    if (!invite || invite.purpose !== 'answer' || !invite.poll_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const poll = await c.env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(invite.poll_id).first<PollRow>();
    if (!poll) return c.json({ error: 'invite_invalid' } as const, 404);

    const subject = await subjectOf(c);
    // 初回のゲストはCookieがまだ無いので、ここで発行してからリンク回答者として判定する
    if (!subject.userId && !subject.guestId) subject.guestId = await ensureGuest(c);
    const target = await pollTarget(c, poll, true);
    if (!can(subject, 'answerPoll', target)) return c.json({ error: 'forbidden' } as const, 403);

    const ids = subject.userId ? { userId: subject.userId } : { guestId: subject.guestId! };
    const key = ids.userId ? `u:${ids.userId}` : `g:${ids.guestId}`;
    if (!await limitAnswer(
      c.env.ANSWER_RESPONDENT_RATE_LIMIT,
      `answer-respondent:${invite.token_hash}:${key}`,
      c.env.ANSWER_RESPONDENT_RATE_LIMIT_PER_MINUTE,
      10,
    )) return rateLimited(c);

    // 調整単位の簡易レート制限: 1時間に新しいゲスト回答者は30人まで。ゲスト識別子を取り直した連投への抑止。
    // 認証済みメンバーは本人を特定できるため枠の対象外。既に回答済みの人の変更は制限しない
    const existing = await c.env.DB.prepare(
      `SELECT id FROM answers WHERE poll_id = ? AND respondent_key = ?`
    ).bind(poll.id, key).first<{ id: string }>();
    if (!existing && !ids.userId) {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recent = await c.env.DB.prepare(
        `SELECT COUNT(DISTINCT respondent_key) AS n FROM answers WHERE poll_id = ? AND created_at > ? AND user_id IS NULL`
      ).bind(poll.id, hourAgo).first<{ n: number }>();
      if ((recent?.n ?? 0) >= 30) return rateLimited(c);
    }

    // 対象調整に属する候補だけを受理し、同一候補の重複送信は最初の1件に絞る
    const validIds = new Set(
      (await all<{ id: string }>(c.env.DB.prepare(`SELECT id FROM candidates WHERE poll_id = ?`).bind(poll.id).all())).map(row => row.id)
    );
    const stale = body.votes.some(v => !validIds.has(v.candidateId));
    const seen = new Set<string>();
    const votes = body.votes.filter(v => validIds.has(v.candidateId) && !seen.has(v.candidateId) && (seen.add(v.candidateId), true));
    // 編集で消えた候補を混ぜた古いフォームの送信は、残った候補だけを受理済みに見せず競合として返す
    if (stale) return c.json({ error: 'stale_candidates' } as const, 409);
    if (!votes.length) return c.json({ error: 'invalid_body' } as const, 400);

    // 締切・確定済みの調整には、既存回答があっても新しい送信を受け付けない
    const accepting = isPollAccepting(poll);
    if (!accepting) return c.json({ error: 'closed' } as const, 410);

    const { wrote, saved, savedVotes } = await writeAnswer(c, poll.id, key, ids, body.name, body.comment ?? null, votes);
    // 受付チェックと書き込みの間に確定・締切が入ると条件付きSQLは0行になる。書き込み後に再読して、
    // 締まっていれば410、受付中なら最新の回答を冪等に返す（同一回答者の競合書き込みも受理扱い）
    const latest = await c.env.DB.prepare(
      `SELECT status, deadline_at, reopen_pending FROM polls WHERE id = ?`
    ).bind(poll.id).first<Pick<PollRow, 'status' | 'deadline_at' | 'reopen_pending'>>();
    const stillOpen = latest ? isPollAccepting(latest) : false;
    if (!stillOpen) return c.json({ error: 'closed' } as const, 410);
    if (!wrote || !saved || (votes.length && !savedVotes.length)) return c.json({ error: 'conflict' } as const, 409);
    const answerVisitorId = subject.guestId ?? await ensureGuest(c);
    await recordAnalytics(c, 'answer_submit', invite.id, poll.id, answerVisitorId);
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
