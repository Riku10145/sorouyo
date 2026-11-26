import type { C } from '../context';
import type { InviteRow } from './db';
import { now } from './time';

export const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

export const newToken = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

export const JOIN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 期限列がない参加リンクは、移行後も旧Workerで発行されたものとして発行時刻から7日後を期限に使う。 */
export const joinInviteExpiresAt = (invite: Pick<InviteRow, 'created_at' | 'expires_at'>) =>
  invite.expires_at ?? new Date(Date.parse(invite.created_at) + JOIN_INVITE_TTL_MS).toISOString();

export const findInvite = async (c: C, token: string) => {
  const hash = await sha256(token);
  const invite = await c.env.DB.prepare(
    `SELECT id, purpose, poll_id, group_id, token_hash, expires_at, revoked_at, created_by, created_at FROM invites WHERE token_hash = ?`
  ).bind(hash).first<InviteRow>();
  if (!invite || invite.revoked_at) return undefined;
  const expired = invite.purpose === 'join'
    ? joinInviteExpiresAt(invite) <= now()
    : invite.expires_at && invite.expires_at <= now();
  if (expired) return undefined;
  return invite;
};
