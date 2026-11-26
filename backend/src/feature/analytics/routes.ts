import { Hono } from 'hono';
import { analyticsDay, type AnalyticsEventType } from '../../analytics';
import type { DataEnv } from '../../context';
import { all } from '../../lib/db';

export const analyticsRoutes = new Hono<{ Bindings: DataEnv }>()
  // 内部用の招待到達率。既定は直近30日の日別。利用者向け画面には出さず、運用者だけがBearerトークンで読む
  .get('/analytics/funnel', async (c) => {
    const token = c.env.ANALYTICS_TOKEN;
    if (!token) return c.json({ error: 'analytics_not_configured' } as const, 503);
    if (c.req.header('authorization') !== `Bearer ${token}`) return c.json({ error: 'unauthenticated' } as const, 401);
    const daysParam = Number(c.req.query('days') ?? '30');
    const days = Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= 90 ? daysParam : 30;
    const end = analyticsDay();
    const startTimestamp = Date.parse(`${end}T00:00:00Z`) - (days - 1) * 24 * 60 * 60 * 1000;
    const dates = Array.from({ length: days }, (_, index) => analyticsDay(startTimestamp + index * 24 * 60 * 60 * 1000));
    const rows = await all<{ day: string; event_type: AnalyticsEventType; n: number }>(c.env.DB.prepare(
      `SELECT occurred_on AS day, event_type, COUNT(*) AS n FROM analytics_events
       WHERE occurred_on >= ? AND occurred_on <= ? AND event_type IN ('invite_visit', 'answer_submit', 'usage_start_click', 'usage_start')
       GROUP BY occurred_on, event_type`
    ).bind(dates[0], end).all());
    const byDay = new Map(dates.map(day => [day, { date: day, validLinkVisits: 0, answerCompletions: 0, usageStartClicks: 0, usageStarts: 0 }]));
    for (const row of rows) {
      const entry = byDay.get(row.day);
      if (!entry) continue;
      if (row.event_type === 'invite_visit') entry.validLinkVisits = row.n;
      else if (row.event_type === 'answer_submit') entry.answerCompletions = row.n;
      else if (row.event_type === 'usage_start_click') entry.usageStartClicks = row.n;
      else if (row.event_type === 'usage_start') entry.usageStarts = row.n;
    }
    const rates = (entry: { validLinkVisits: number; answerCompletions: number; usageStartClicks: number; usageStarts: number }) => ({
      completionRate: entry.validLinkVisits ? entry.answerCompletions / entry.validLinkVisits : null,
      usageStartClickRate: entry.answerCompletions ? entry.usageStartClicks / entry.answerCompletions : null,
      usageStartRate: entry.answerCompletions ? entry.usageStarts / entry.answerCompletions : null,
    });
    const daily = [...byDay.values()].map(entry => ({ ...entry, ...rates(entry) }));
    const totals = daily.reduce((sum, entry) => ({
      validLinkVisits: sum.validLinkVisits + entry.validLinkVisits,
      answerCompletions: sum.answerCompletions + entry.answerCompletions,
      usageStartClicks: sum.usageStartClicks + entry.usageStartClicks,
      usageStarts: sum.usageStarts + entry.usageStarts,
    }), { validLinkVisits: 0, answerCompletions: 0, usageStartClicks: 0, usageStarts: 0 });
    return c.json({
      range: { start: dates[0], end, days },
      definition: {
        visit: '有効な回答リンクを開いた回数。無効リンクは分母に含めない',
        completion: '有効な回答リンクから回答書き込みが受理された回数',
        usageStartClick: '回答完了画面で「自分のグループを作る」が押された回数',
        usageStart: 'ゲスト回答者がログインし、最初の自分のグループを作成した回数',
        dedupe: 'イベント種別＋招待の内部ID＋匿名訪問者Cookieで一意。再読込・再送は重複除外し、再発行リンクは別の招待として数える。usage_startだけは利用開始済みの匿名訪問者を別招待でも再計上しない',
        rate: 'completionRateは answerCompletions / validLinkVisits、usageStartClickRateとusageStartRateは分母をanswerCompletionsとする。日別も同じ日に記録された数値の比',
        future: '有料転換率は checkout_completed を同じ匿名イベント構造で追加して区別する',
      },
      totals: { ...totals, ...rates(totals) },
      daily,
    } as const);
  });
