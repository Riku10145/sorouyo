import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { GROUP_CREATION_LIMIT } from '../../../../shared/limits';
import { createGroupBody, inviteBody } from '../../../../shared/schema';
import { measureUsageStart } from '../../analytics';
import { GUEST_COOKIE, checkOrigin, verifyGuestId } from '../../auth';
import type { DataEnv } from '../../context';
import { type GetSubject, memberRole } from '../../lib/access';
import { type GroupRow, type InviteRow, all } from '../../lib/db';
import { findInvite } from '../../lib/invites';
import { now } from '../../lib/time';
import { json } from '../../validation';
import { presentJoinInvite, latestJoinInvite, reissueJoinInvite } from './invites';

export function groupsRoutes(subjectOf: GetSubject) {
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

  // グループ作成。作成者はadminとして所属する。上限判定と挿入は1つのSQLにし、同時送信でも上限を超えないようにする
  .post('/groups', json(createGroupBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const body = c.req.valid('json');
    const id = crypto.randomUUID();
    const at = now();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO groups (id, name, color, created_by, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE (
           SELECT COUNT(*) FROM groups WHERE created_by = ?
         ) + (
           SELECT COUNT(*) FROM groups AS g
           WHERE g.created_by IS NULL AND (
             SELECT m.user_id FROM memberships AS m
             WHERE m.group_id = g.id AND m.role = 'admin'
             ORDER BY m.created_at, m.user_id
             LIMIT 1
           ) = ?
         ) < ?`
      ).bind(id, body.name, body.color ?? null, subject.userId, at, subject.userId, subject.userId, GROUP_CREATION_LIMIT),
      c.env.DB.prepare(
        `INSERT INTO memberships (group_id, user_id, role, created_at)
         SELECT ?, ?, 'admin', ? WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?)`
      ).bind(id, subject.userId, at, id),
    ]);
    if (!results[0]?.meta?.changes) return c.json({ error: 'group_limit' } as const, 409);
    const guestId = await verifyGuestId(getCookie(c, GUEST_COOKIE), c.env);
    if (guestId) await measureUsageStart(c, subject.userId, guestId);
    return c.json({ group: { id, name: body.name, color: body.color ?? null, role: 'admin' } } as const, 201);
  })

  // グループ参加用リンクの発行・再発行（adminのみ）。有効なリンクは1本だけで、7日で期限切れになる
  .post('/groups/:id/invites', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const { token, invite } = await reissueJoinInvite(c, groupId, subject.userId);
    return c.json({ token, invite } as const, 201);
  })

  // 参加リンクの無効化（adminのみ）。トークンではなく invitation id を指定し、リンク漏洩時に即座に止められるようにする
  .post('/groups/:id/invites/:inviteId/revoke', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const invite = await c.env.DB.prepare(
      `SELECT id, purpose, poll_id, group_id, token_hash, expires_at, revoked_at, created_by, created_at
       FROM invites WHERE id = ? AND purpose = 'join' AND group_id = ?`
    ).bind(c.req.param('inviteId'), groupId).first<InviteRow>();
    if (!invite) return c.json({ error: 'not_found' } as const, 404);
    const revokedAt = invite.revoked_at ?? now();
    if (!invite.revoked_at) {
      await c.env.DB.prepare(`UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(revokedAt, invite.id).run();
    }
    return c.json({ invite: presentJoinInvite({ ...invite, revoked_at: revokedAt }) } as const, 200);
  })

  // 参加リンクのプレビュー。リンクを持つ人にグループ名・招待元・参加すると見える情報だけを出す
  .post('/groups/join/preview', json(inviteBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const body = c.req.valid('json');
    const invite = await findInvite(c, body.token);
    if (!invite || invite.purpose !== 'join' || !invite.group_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const group = await c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(invite.group_id).first<GroupRow>();
    if (!group) return c.json({ error: 'invite_invalid' } as const, 404);
    const subject = await subjectOf(c);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const [inviter, memberCount, upcoming] = await Promise.all([
      invite.created_by
        ? c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(invite.created_by).first<{ display_name: string | null }>()
        : Promise.resolve(null),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE group_id = ?`).bind(invite.group_id).first<{ n: number }>(),
      all<{ date: string; title: string }>(c.env.DB.prepare(
        `SELECT date, title FROM events WHERE group_id = ? AND date >= ? ORDER BY date, start_time LIMIT 3`
      ).bind(invite.group_id, today).all()),
    ]);
    const member = subject.userId ? (await memberRole(c, invite.group_id, subject.userId)) !== undefined : false;
    return c.json({
      group,
      inviterName: inviter?.display_name ?? null,
      memberCount: memberCount?.n ?? 0,
      upcoming,
      member,
    } as const);
  })

  // 参加リンクでログイン済み利用者が明示的に「参加」して所属を作る。再参加は冪等（役割は変えない）
  .post('/groups/join', json(inviteBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const body = c.req.valid('json');
    const invite = await findInvite(c, body.token);
    if (!invite || invite.purpose !== 'join' || !invite.group_id) {
      return c.json({ error: 'invite_invalid' } as const, 404);
    }
    const group = await c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(invite.group_id).first<GroupRow>();
    if (!group) return c.json({ error: 'invite_invalid' } as const, 404);
    const existing = await memberRole(c, invite.group_id, subject.userId);
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO memberships (group_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)
         ON CONFLICT (group_id, user_id) DO NOTHING`
      ).bind(invite.group_id, subject.userId, now()).run();
    }
    return c.json({ group: { ...group, role: existing ?? 'member' }, already: existing !== undefined } as const, existing ? 200 : 201);
  })

  // グループ詳細（メンバー以上）。メンバー一覧と、削除確認に出す件数を含める
  .get('/groups/:id', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    const role = await memberRole(c, groupId, subject.userId);
    if (!role) return c.json({ error: 'forbidden' } as const, 403);
    const group = await c.env.DB.prepare(`SELECT id, name, color FROM groups WHERE id = ?`).bind(groupId).first<GroupRow>();
    if (!group) return c.json({ error: 'not_found' } as const, 404);
    const [members, counts, joinInvite] = await Promise.all([
      all<{ user_id: string; display_name: string | null; email: string | null; role: 'admin' | 'member' }>(c.env.DB.prepare(
        `SELECT m.user_id, u.display_name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ? ORDER BY m.created_at`
      ).bind(groupId).all()),
      c.env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM events WHERE group_id = ?) AS events,
                (SELECT COUNT(*) FROM polls WHERE group_id = ?) AS polls`
      ).bind(groupId, groupId).first<{ events: number; polls: number }>(),
      latestJoinInvite(c, groupId),
    ]);
    return c.json({
      group: { ...group, role },
      members: members.map(m => ({ id: m.user_id, name: m.display_name ?? m.email ?? '名無し', role: m.role, you: m.user_id === subject.userId })),
      counts: { events: counts?.events ?? 0, polls: counts?.polls ?? 0, members: members.length },
      joinInvite: role === 'admin' && joinInvite ? presentJoinInvite(joinInvite) : null,
    } as const);
  })

  // グループの名前・色の変更（管理者のみ）
  .patch('/groups/:id', json(createGroupBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const body = c.req.valid('json');
    const result = await c.env.DB.prepare(`UPDATE groups SET name = ?, color = ? WHERE id = ?`)
      .bind(body.name, body.color ?? null, groupId).run();
    if (!result.meta.changes) return c.json({ error: 'not_found' } as const, 404);
    return c.json({ group: { id: groupId, name: body.name, color: body.color ?? null, role: 'admin' } } as const);
  })

  // グループの削除（管理者のみ）。所属・予定・調整・候補・回答・票・招待を同一バッチで消す
  .delete('/groups/:id', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if ((await memberRole(c, groupId, subject.userId)) !== 'admin') {
      return c.json({ error: 'forbidden' } as const, 403);
    }
    const inPolls = `SELECT id FROM polls WHERE group_id = ?`;
    const inAnswers = `SELECT id FROM answers WHERE poll_id IN (${inPolls})`;
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM votes WHERE answer_id IN (${inAnswers})`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM answers WHERE poll_id IN (${inPolls})`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM candidates WHERE poll_id IN (${inPolls})`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM invites WHERE group_id = ? OR poll_id IN (${inPolls})`).bind(groupId, groupId),
      c.env.DB.prepare(`DELETE FROM events WHERE group_id = ?`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM polls WHERE group_id = ?`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM memberships WHERE group_id = ?`).bind(groupId),
      c.env.DB.prepare(`DELETE FROM groups WHERE id = ?`).bind(groupId),
    ]);
    return c.body(null, 204);
  });
}
