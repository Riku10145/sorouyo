import { dateKey, timeLabel } from '../../../lib/date';

/** 当日の通知時刻（端末ローカル）。time は HH:MM */
export function fireAt(now: Date, time: string): Date {
  const [hour = 8, minute = 0] = time.split(':').map(Number);
  const at = new Date(now);
  at.setHours(hour, minute, 0, 0);
  return at;
}

/** 通知を出すべき状態か。同じ日に2回は出さない */
export function shouldFire(now: Date, time: string, lastFired: string | null): boolean {
  if (lastFired === dateKey(now)) return false;
  return fireAt(now, time).getTime() <= now.getTime();
}

/** 通知1件にまとめる本文。時刻つきは時刻を前に出す */
export function digestBody(events: readonly { title: string; startTime: string | null }[]): string {
  return events.map(event => `${timeLabel(event.startTime ?? '')} ${event.title}`.trim()).join('、');
}

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;
