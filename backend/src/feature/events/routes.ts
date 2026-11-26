import { Hono } from 'hono';
import { eventBody } from '../../../../shared/schema';
import { checkOrigin } from '../../auth';
import type { DataEnv } from '../../context';
import { type GetSubject, memberRole } from '../../lib/access';
import { type EventRow, all } from '../../lib/db';
import { now } from '../../lib/time';
import { json } from '../../validation';

const monthQuery = /^\d{4}-\d{2}$/;

export function eventsRoutes(subjectOf: GetSubject) {
  return new Hono<{ Bindings: DataEnv }>()
  // 予定の詳細（所属メンバーのみ）
  .get('/events/:id', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const event = await c.env.DB.prepare(
      `SELECT e.*, g.name AS group_name, g.color AS group_color FROM events e JOIN groups g ON g.id = e.group_id WHERE e.id = ?`
    ).bind(c.req.param('id')).first<EventRow & { group_name: string; group_color: string | null }>();
    if (!event) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, event.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    return c.json({
      event: {
        id: event.id, date: event.date, startTime: event.start_time, title: event.title, memo: event.memo,
        group: { id: event.group_id, name: event.group_name, color: event.group_color },
        sourcePollId: event.source_poll_id,
      },
    } as const);
  })

  // 予定の編集（所属メンバー）。調整から作られた予定はタイトルとメモだけ直接編集できる
  .patch('/events/:id', json(eventBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const event = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(c.req.param('id')).first<EventRow>();
    if (!event) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, event.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    const body = c.req.valid('json');
    const sourced = event.source_poll_id !== null;
    const date = sourced ? event.date : body.date;
    const time = sourced ? event.start_time : body.time ?? null;
    const result = await c.env.DB.prepare(
      `UPDATE events SET title = ?, memo = ?, date = ?, start_time = ? WHERE id = ?`
    ).bind(body.title, body.memo ?? null, date, time, event.id).run();
    if (!result.meta.changes) return c.json({ error: 'not_found' } as const, 404);
    return c.json({ event: { id: event.id } } as const);
  })

  // 通常予定の削除（所属メンバー）。調整から作られた予定は確定取消で消す
  .delete('/events/:id', async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const event = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(c.req.param('id')).first<EventRow>();
    if (!event) return c.json({ error: 'not_found' } as const, 404);
    if (!(await memberRole(c, event.group_id, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    if (event.source_poll_id) return c.json({ error: 'poll_event' } as const, 409);
    await c.env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(event.id).run();
    return c.body(null, 204);
  })

  // 予定の追加（メンバー以上）
  .post('/groups/:id/events', json(eventBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const groupId = c.req.param('id');
    if (!(await memberRole(c, groupId, subject.userId))) return c.json({ error: 'forbidden' } as const, 403);
    const body = c.req.valid('json');
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO events (id, group_id, date, start_time, title, memo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, groupId, body.date, body.time ?? null, body.title, body.memo ?? null, now()).run();
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
        id: e.id, date: e.date, startTime: e.start_time, title: e.title, memo: e.memo,
        group: { id: e.group_id, name: e.group_name, color: e.group_color },
        sourcePollId: e.source_poll_id,
      })),
    } as const);
  });
}
