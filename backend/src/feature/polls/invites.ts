import { ANSWER_INVITE_LIMIT_PER_POLL } from '../../../../shared/limits';
import type { C } from '../../context';
import { sha256, newToken } from '../../lib/invites';
import { now } from '../../lib/time';

export const newAnswerInvite = async (c: C, pollId: string, createdBy?: string) => {
  const token = newToken();
  const result = await c.env.DB.prepare(
    `INSERT INTO invites (id, purpose, poll_id, token_hash, created_by, created_at)
     SELECT ?, 'answer', ?, ?, ?, ?
     WHERE (
       SELECT COUNT(*) FROM invites
       WHERE purpose = 'answer' AND poll_id = ? AND revoked_at IS NULL
     ) < ?`
  ).bind(crypto.randomUUID(), pollId, await sha256(token), createdBy ?? null, now(), pollId, ANSWER_INVITE_LIMIT_PER_POLL).run();
  return result.meta.changes ? token : null;
};
