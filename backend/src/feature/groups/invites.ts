import type { C } from '../../context';
import type { InviteRow } from '../../lib/db';
import { sha256, newToken, JOIN_INVITE_TTL_MS, joinInviteExpiresAt } from '../../lib/invites';
import { now } from '../../lib/time';

const joinInviteState = (invite: Pick<InviteRow, 'created_at' | 'expires_at' | 'revoked_at'>, at = now()) => {
  if (invite.revoked_at) return 'revoked' as const;
  if (joinInviteExpiresAt(invite) <= at) return 'expired' as const;
  return 'active' as const;
};

export const presentJoinInvite = (invite: InviteRow) => ({
  id: invite.id,
  createdAt: invite.created_at,
  expiresAt: joinInviteExpiresAt(invite),
  state: joinInviteState(invite),
} as const);

export const latestJoinInvite = async (c: C, groupId: string) => c.env.DB.prepare(
  `SELECT id, purpose, poll_id, group_id, token_hash, expires_at, revoked_at, created_by, created_at
   FROM invites WHERE purpose = 'join' AND group_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
).bind(groupId).first<InviteRow>();

/** 参加リンクはグループごと1本だけ有効にするため、旧リンクの失効と新リンクの作成を同一バッチで行う。 */
export const reissueJoinInvite = async (c: C, groupId: string, createdBy: string) => {
  const token = newToken();
  const id = crypto.randomUUID();
  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const expiresAt = new Date(createdAtMs + JOIN_INVITE_TTL_MS).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE invites SET revoked_at = ? WHERE purpose = 'join' AND group_id = ? AND revoked_at IS NULL`)
      .bind(createdAt, groupId),
    c.env.DB.prepare(
      `INSERT INTO invites (id, purpose, group_id, token_hash, expires_at, created_by, created_at) VALUES (?, 'join', ?, ?, ?, ?, ?)`
    ).bind(id, groupId, await sha256(token), expiresAt, createdBy, createdAt),
  ]);
  return { token, invite: { id, createdAt, expiresAt, state: 'active' as const } };
};
