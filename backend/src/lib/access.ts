import { getCookie } from 'hono/cookie';
import { GUEST_COOKIE, resolveUser, verifyGuestId, type GetAuthDeps } from '../auth';
import type { C } from '../context';
import { type MemberRow, type PollRow, all } from './db';
import type { PollTarget, Subject } from './permissions';
import { now } from './time';

export type GetSubject = (c: C) => Promise<Subject>;

export const makeSubjectOf = (getDeps: GetAuthDeps): GetSubject => async (c) => {
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
  const email = user.email ?? null;
  const name = [user.lastName, user.firstName].filter(Boolean).join(' ') || null;
  const existing = await c.env.DB.prepare(
    `SELECT email, display_name FROM users WHERE id = ?`
  ).bind(user.id).first<{ email: string | null; display_name: string | null }>();
  // メール・表示名に変化がなければ書き込まない（認証済みリクエストごとのupsertを避ける）
  if (existing && existing.email === email && existing.display_name === name) return;
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at`
  ).bind(user.id, email, name, now(), now()).run();
}

/** 調整の作成者・メンバー・管理者をまとめて PollTarget にする。 */
export async function pollTarget(c: C, poll: PollRow, inviteValid: boolean): Promise<PollTarget> {
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

export const memberRole = async (c: C, groupId: string, userId: string) =>
  (await c.env.DB.prepare(
    `SELECT role FROM memberships WHERE group_id = ? AND user_id = ?`
  ).bind(groupId, userId).first<{ role: 'admin' | 'member' }>())?.role;

/** created_by がない移行期間のグループでは最初のadminを作成者とみなす。 */
export const groupCreatorId = async (c: C, groupId: string) => {
  const row = await c.env.DB.prepare(
    `SELECT g.created_by,
            (SELECT m.user_id FROM memberships m WHERE m.group_id = g.id AND m.role = 'admin' ORDER BY m.created_at, m.user_id LIMIT 1) AS legacy_creator_id
     FROM groups g WHERE g.id = ?`
  ).bind(groupId).first<{ created_by: string | null; legacy_creator_id: string | null }>();
  if (!row) return undefined;
  return row.created_by ?? row.legacy_creator_id ?? null;
};
