import { Hono } from 'hono';
import { notificationSettingsBody } from '../../../../shared/schema';
import { checkOrigin } from '../../auth';
import type { DataEnv } from '../../context';
import type { GetSubject } from '../../lib/access';
import { now } from '../../lib/time';
import { json } from '../../validation';

export function settingsRoutes(subjectOf: GetSubject) {
  return new Hono<{ Bindings: DataEnv }>()
  // 通知設定の読み出し（本人のみ）。未設定なら無効・既定時刻を返す
  .get('/settings/notifications', async (c) => {
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const row = await c.env.DB.prepare(
      `SELECT notify_enabled, notify_time FROM user_settings WHERE user_id = ?`
    ).bind(subject.userId).first<{ notify_enabled: number; notify_time: string }>();
    return c.json({
      enabled: Boolean(row?.notify_enabled),
      time: row?.notify_time ?? '08:00',
    } as const);
  })

  // 通知設定の保存（本人のみ）。冪等なupsertで、時刻はHH:MMに検証済み
  .put('/settings/notifications', json(notificationSettingsBody), async (c) => {
    if (!checkOrigin(c)) return c.json({ error: 'bad_origin' } as const, 403);
    const subject = await subjectOf(c);
    if (!subject.userId) return c.json({ error: 'unauthenticated' } as const, 401);
    const body = c.req.valid('json');
    await c.env.DB.prepare(
      `INSERT INTO user_settings (user_id, notify_enabled, notify_time, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET notify_enabled = excluded.notify_enabled, notify_time = excluded.notify_time, updated_at = excluded.updated_at`
    ).bind(subject.userId, body.enabled ? 1 : 0, body.time, now()).run();
    return c.json({ enabled: body.enabled, time: body.time } as const);
  });
}
