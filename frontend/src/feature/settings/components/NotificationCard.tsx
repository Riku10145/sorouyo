import { useEffect, useRef, useState } from 'react';
import { toast } from '../../../components/Toaster';
import { fetchNotificationSettings, saveNotificationSettings, type NotificationSettings } from '../api';
import { notifySupported } from '../lib/notifications';
import { resetNotificationSchedule } from '../notifications';

/** #32 予定通知の設定カード。通知APIのない端末では非対応であることだけを示す */
export function NotificationCard() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [permission, setPermission] = useState(() => notifySupported() ? Notification.permission : 'unsupported');
  useEffect(() => {
    let active = true;
    void fetchNotificationSettings().then(found => { if (active) setSettings(found ?? { enabled: false, time: '08:00' }); });
    return () => { active = false; };
  }, []);
  if (!notifySupported()) {
    return <section className="invite-card">
      <h2>予定の通知</h2>
      <p className="note">この端末・ブラウザは通知に対応していません。カレンダーはそのまま使えます。</p>
    </section>;
  }
  if (!settings) return null;
  const save = (next: NotificationSettings) => {
    setSettings(next);
    // 直列に保存する。並行すると後から届いた古い保存で、切ったはずの通知がオンに戻ることがある
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        if (!(await saveNotificationSettings(next))) throw new Error('save failed');
        toast('通知設定を保存しました');
        resetNotificationSchedule();
      } catch {
        // HTTPエラー・通信例外どちらでも、サーバーの現在値に表示を戻して失敗を伝える
        const server = await fetchNotificationSettings().catch(() => null);
        if (server) setSettings(server);
        toast('通知設定を保存できませんでした');
      }
      setPermission(Notification.permission);
    });
  };
  const toggle = async () => {
    if (!settings.enabled && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => 'denied');
      setPermission(Notification.permission);
    }
    void save({ ...settings, enabled: !settings.enabled });
  };
  return <section className="invite-card">
    <h2>予定の通知</h2>
    <p className="note">当日の予定を、指定した時刻に1回だけ通知します。</p>
    <label className="field notify-toggle">
      <span>通知を受け取る</span>
      <input type="checkbox" checked={settings.enabled} onChange={() => void toggle()} />
    </label>
    <label className="field notify-time">
      <span>通知する時刻</span>
      <input type="time" value={settings.time} disabled={!settings.enabled}
        onChange={event => { if (event.target.value) void save({ ...settings, time: event.target.value }); }} />
    </label>
    {settings.enabled && permission === 'denied' && <p className="form-error" role="alert">通知が許可されていません。ブラウザの設定から許可してください。カレンダーはそのまま使えます。</p>}
    {settings.enabled && permission === 'default' && <p className="note">初めて通知するときに、ブラウザから許可を求められます。</p>}
  </section>;
}
