import type { C } from '../../context';
import { type AnswerRow, type VoteRow, all } from '../../lib/db';
import { ACCEPTING_POLL_WHERE } from '../../lib/polls';
import { now } from '../../lib/time';

/** 回答行の作成・更新と各票の差し替えを、受付中であることをSQL条件に含めて同一バッチで行う。 */
export async function writeAnswer(
  c: C, pollId: string, key: string, ids: { userId?: string; guestId?: string },
  name: string, comment: string | null, votes: { candidateId: string; value: string }[],
) {
  const answerId = crypto.randomUUID();
  const at = now();
  const candidateIds = [...new Set(votes.map(vote => vote.candidateId))];
  const candidateGuard = candidateIds.length
    ? `(SELECT COUNT(DISTINCT id) FROM candidates WHERE poll_id = ? AND id IN (${candidateIds.map(() => '?').join(',')})) = ${candidateIds.length}`
    : '1 = 1';
  const guardBinds = candidateIds.length ? [pollId, ...candidateIds] : [];
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO answers (id, poll_id, respondent_key, user_id, guest_id, display_name, comment, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM polls WHERE id = ? AND ${ACCEPTING_POLL_WHERE}) AND (${candidateGuard})
       ON CONFLICT (poll_id, respondent_key) DO UPDATE SET
         display_name = excluded.display_name, comment = excluded.comment, updated_at = excluded.updated_at
       WHERE EXISTS (SELECT 1 FROM polls WHERE id = excluded.poll_id AND ${ACCEPTING_POLL_WHERE})`
    ).bind(answerId, pollId, key, ids.userId ?? null, ids.guestId ?? null, name, comment, at, at, pollId, at, ...guardBinds, at),
    c.env.DB.prepare(
      `DELETE FROM votes WHERE answer_id = (SELECT id FROM answers WHERE poll_id = ? AND respondent_key = ?)
       AND EXISTS (SELECT 1 FROM polls WHERE id = ? AND ${ACCEPTING_POLL_WHERE}) AND (${candidateGuard})`
    ).bind(pollId, key, pollId, at, ...guardBinds),
    // 回答書き込みで調整の版を進め、開いていた編集画面が新しい票を見落としたまま保存しないようにする
    c.env.DB.prepare(
      `UPDATE polls SET edit_version = edit_version + 1 WHERE id = ? AND ${ACCEPTING_POLL_WHERE} AND (${candidateGuard})`
    ).bind(pollId, at, ...guardBinds),
  ];
  for (const vote of votes) {
    stmts.push(c.env.DB.prepare(
      `INSERT INTO votes (answer_id, candidate_id, value)
       SELECT (SELECT id FROM answers WHERE poll_id = ? AND respondent_key = ?), c.id, ?
       FROM candidates c JOIN polls p ON p.id = c.poll_id
       WHERE c.id = ? AND c.poll_id = ? AND p.${ACCEPTING_POLL_WHERE} AND (${candidateGuard})`
    ).bind(pollId, key, vote.value, vote.candidateId, pollId, at, ...guardBinds));
  }
  const results = await c.env.DB.batch(stmts);
  const wrote = !!results[0]?.meta?.changes && !!results[2]?.meta?.changes;
  const saved = await c.env.DB.prepare(
    `SELECT * FROM answers WHERE poll_id = ? AND respondent_key = ?`
  ).bind(pollId, key).first<AnswerRow>();
  const savedVotes = await all<VoteRow>(c.env.DB.prepare(
    `SELECT v.* FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.poll_id = ? AND a.respondent_key = ?`
  ).bind(pollId, key).all());
  // 受付中でないと条件付き書き込みは0行になり、 saved には古い行が残る。受付判定は呼び出し側で行う
  return { wrote, saved: saved ?? null, savedVotes };
}
