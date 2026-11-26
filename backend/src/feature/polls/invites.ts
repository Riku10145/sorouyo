import type { C } from '../../context';
import { sha256, newToken } from '../../lib/invites';
import { now } from '../../lib/time';

export const newAnswerInvite = async (c: C, pollId: string, createdBy?: string) => {
  const token = newToken();
  await c.env.DB.prepare(
    `INSERT INTO invites (id, purpose, poll_id, token_hash, created_by, created_at) VALUES (?, 'answer', ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), pollId, await sha256(token), createdBy ?? null, now()).run();
  return token;
};
