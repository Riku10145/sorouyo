import { dateKey } from './lib/model';
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
      // 初回登録ではworkerがまだactiveでないことがある。AndroidのChromeはコンストラクタに倒せないため、
      // activeになるのを待ってから表示する
      await navigator.serviceWorker.register('/sw.js');
      const ready = await navigator.serviceWorker.ready;
      await ready.showNotification(title, options);
      return;
    } catch { /* Service Workerが使えない環境はコンストラクタに倒す */ }
  }
  new Notification(title, options);
}

/** 発射判定と通知本体。設定・予定・許可をその時点で確認し直す。戻り値は通知を出したか */
export async function fireTodayNotification(now: Date): Promise<boolean> {
  try {
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
    // 表示に成功してから既読にする。並行する発射は tag の置き換えで1件にまとまる
    await showNotification('そろうよ 今日の予定', { body: digestBody(events), tag: `sorouyo-${today}` });
    notified(today);
    return true;
  } catch {
    // 通信失敗や通知の拒否では未通知のままにし、次に開いたときの発射に委ねる
    return false;
  }
}

let scheduled = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const DAY = 24 * 60 * 60 * 1000;

/** 次回の発射時刻にタイマーを仕掛ける。発射後は翌日以降も届くよう設定を読み直して再度仕掛ける */
function armTimer(time: string): void {
  clearTimeout(timer);
  const current = new Date();
  let delay = fireAt(current, time).getTime() - current.getTime();
  if (delay <= 0) delay += DAY; // 今日の指定時刻を過ぎていれば明日の分
  timer = setTimeout(() => {
    void fireTodayNotification(new Date()).then(async () => {
      const latest = await fetchNotificationSettings().catch(() => null);
      if (latest?.enabled) armTimer(latest.time); // 無効化されていればここで止まる
    });
  }, delay);
}

/** アプリ起動時に1度だけ呼ぶ。未ログインや未許可なら何もしない */
export function scheduleEventNotifications(): void {
  if (scheduled) return;
  scheduled = true;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  void fetchNotificationSettings().then(settings => {
    if (!settings?.enabled) return;
    const current = new Date();
    const lastFired = localStorage.getItem(FIRED_KEY);
    // 開いた時点で当日分が未通知ならその場で1回出す
    if (shouldFire(current, settings.time, lastFired)) {
      void fireTodayNotification(current);
    }
    armTimer(settings.time);
  }).catch(() => { /* 設定を読めない環境では通知しない */ });
}

/** 設定画面から保存直後に呼ぶ。有効化したその場で条件がそろえば通知スケジュールを作り直す */
export function resetNotificationSchedule(): void {
  scheduled = false;
  scheduleEventNotifications();
}
