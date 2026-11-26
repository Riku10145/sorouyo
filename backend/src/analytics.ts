import type { C } from './context';
import { now } from './lib/time';

export const analyticsDay = (timestamp = Date.now()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(timestamp));

/** 匿名の訪問者Cookieだけを使い、表示名・予定名・コメント・リンク秘密部分を残さない。 */
export type AnalyticsEventType = 'invite_visit' | 'answer_submit' | 'usage_start_click' | 'usage_start';

export async function recordAnalytics(
  c: C, eventType: AnalyticsEventType, inviteId: string | null, pollId: string | null, visitorId: string,
) {
  // 計測の失敗で本体の回答・閲覧・グループ作成を失敗させない
  const at = now();
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO analytics_events
       (id, event_type, visitor_id, invite_id, poll_id, occurred_on, created_at, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), eventType, visitorId, inviteId, pollId,
      analyticsDay(), at, `${eventType}:${inviteId ?? 'none'}:${visitorId}`,
    ).run();
  } catch {
    console.warn('analytics event write failed');
  }
}

/** ゲスト回答後に初めて自分のグループを作った利用開始を、同じ匿名訪問者IDで記録する。 */
async function recordUsageStart(c: C, visitorId: string) {
  const source = await c.env.DB.prepare(
    `SELECT invite_id, poll_id FROM analytics_events
     WHERE visitor_id = ? AND event_type IN ('usage_start_click', 'answer_submit')
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).bind(visitorId).first<{ invite_id: string | null; poll_id: string | null }>();
  if (!source?.invite_id || !source.poll_id) return;
  await recordAnalytics(c, 'usage_start', source.invite_id, source.poll_id, visitorId);
}

/** グループ作成本体は計測失敗で失敗させず、計測済みの利用開始は別招待で重複させない。 */
export async function measureUsageStart(c: C, userId: string, visitorId: string) {
  try {
    const started = await c.env.DB.prepare(
      `SELECT visitor_id FROM analytics_events WHERE event_type = 'usage_start' AND visitor_id = ? LIMIT 1`
    ).bind(visitorId).first<{ visitor_id: string }>();
    if (started) return;
    const createdCount = await c.env.DB.prepare(
      `SELECT (
         SELECT COUNT(*) FROM groups WHERE created_by = ?
       ) + (
         SELECT COUNT(*) FROM groups AS g
         WHERE g.created_by IS NULL AND (
           SELECT m.user_id FROM memberships AS m
           WHERE m.group_id = g.id AND m.role = 'admin'
           ORDER BY m.created_at, m.user_id
           LIMIT 1
         ) = ?
       ) AS n`
    ).bind(userId, userId).first<{ n: number }>();
    if (createdCount?.n === 1) await recordUsageStart(c, visitorId);
  } catch {
    console.warn('usage start measurement failed');
  }
}
