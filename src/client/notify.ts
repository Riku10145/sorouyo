import { dateKey } from '../shared/model';
import { fetchCalendar, fetchNotificationSettings } from './api';
import { digestBody, fireAt, shouldFire } from './notifyLogic';

/**
 * #32 予定通知。採用した手段はブラウザの通知APIによるローカル通知（docs/notifications.md）。
 * アプリを開いている間は指定時刻にタイマーで、開いた時点で当日分が未通知ならその場で1回だけ出す。
 * 通知の発射時点で設定と予定を取り直すので、通知を切った場合や予定を削除した場合には届かない。
 */

export const FIRED_KEY = 'sorouyo-notify-fired';

const notified = (day: string) => localStorage.setItem(FIRED_KEY, day);

// AndroidのChromeは new Notification() を投げるため、Service Worker経由の表示を優先する
async function showNotification(title: string, options: NotificationOptions): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await registration.showNotification(title, options);
      return;
    } catch { /* Service Workerが使えない環境はコンストラクタに倒す */ }
  }
  new Notification(title, options);
}

/** 発射判定と通知本体。設定・予定・許可をその時点で確認し直す。戻り値は通知を出したか */
export async function fireTodayNotification(now: Date): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const today = dateKey(now);
  // 別タブのタイマーと同日に重なっても1回だけにする
  if (localStorage.getItem(FIRED_KEY) === today) return false;
  const settings = await fetchNotificationSettings();
  if (!settings?.enabled) return false;
  // 時刻を変更したあとに古いタイマーが残っていても、新しい通知時刻の前には出さない
  if (fireAt(now, settings.time).getTime() > now.getTime()) return false;
  const month = today.slice(0, 7);
  const events = (await fetchCalendar(month) ?? []).filter(event => event.date === today);
  // 対象の予定がなければ通知しない。既読にはせず、予定が増えてから開けば届くようにする
  if (!events.length) return false;
  // 通知を出す直前に二重発射を防ぐ。並行する発射は tag の置き換えで1件にまとまる
  notified(today);
  await showNotification('そろうよ 今日の予定', { body: digestBody(events), tag: `sorouyo-${today}` });
  return true;
}

let scheduled = false;

/** アプリ起動時に1度だけ呼ぶ。未ログインや未許可なら何もしない */
export function scheduleEventNotifications(): void {
  if (scheduled) return;
  scheduled = true;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  void fetchNotificationSettings().then(settings => {
    if (!settings?.enabled) return;
    const current = new Date();
    const lastFired = localStorage.getItem(FIRED_KEY);
    if (shouldFire(current, settings.time, lastFired)) {
      void fireTodayNotification(current);
      return;
    }
    // 指定時刻がまだなら、その時刻にタイマーを仕掛ける（アプリを開いている間に届く）
    const delay = fireAt(current, settings.time).getTime() - current.getTime();
    if (delay > 0) setTimeout(() => void fireTodayNotification(new Date()), delay);
  }).catch(() => { /* 設定を読めない環境では通知しない */ });
}

/** 設定画面から保存直後に呼ぶ。有効化したその場で条件がそろえば通知スケジュールを作り直す */
export function resetNotificationSchedule(): void {
  scheduled = false;
  scheduleEventNotifications();
}
