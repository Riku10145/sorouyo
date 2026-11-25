import { useEffect, useState } from 'react';
import { Brand, Icon } from '../design/ui';
import { GuestFrame } from './GuestAnswer';
import { api, useMe, fetchNotificationSettings, saveNotificationSettings, type Me, type NotificationSettings } from '../api';
import { resetNotificationSchedule } from '../notify';
import { toast } from '../design/ui';

const displayName = (me: Me) =>
  [me.user.lastName, me.user.firstName].filter(Boolean).join(' ') || me.user.email;

const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** #32 予定通知の設定カード。通知APIのない端末では非対応であることだけを示す */
function NotificationCard() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
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
  const save = async (next: NotificationSettings) => {
    const previous = settings;
    setSettings(next);
    const ok = await saveNotificationSettings(next);
    if (ok) {
      toast('通知設定を保存しました');
      resetNotificationSchedule();
    } else {
      setSettings(previous); // 保存できなかったのにオンに見せない
      toast('通知設定を保存できませんでした');
    }
    setPermission(Notification.permission);
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

export function Settings() {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [loginUnavailable, setLoginUnavailable] = useState(false);
  // 未設定環境では /api/auth/login が生の503 JSONを返すので、先に確認して画面内にお知らせする
  const login = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    try {
      const res = await fetch('/api/auth/login', { redirect: 'manual' });
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        window.location.href = '/api/auth/login';
      } else {
        setLoginUnavailable(true);
      }
    } catch {
      window.location.href = '/api/auth/login';
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      const response = await api.api.auth.logout.$post();
      const data = await response.json();
      window.location.href = (response.ok && 'logoutUrl' in data ? data.logoutUrl : null) ?? '/';
    } catch {
      setBusy(false);
    }
  };
  return <GuestFrame>
    <header className="guest-header"><Brand size={28} sub="設定" /></header>
    <h1 className="page-title">設定</h1>
    {me === undefined && <p className="lead">読み込み中…</p>}
    {me === null && <>
      <section className="invite-card">
        <Icon name="link" size={32} />
        <h2>ログインしていません</h2>
        <p>主催者としてログインすると、自分のグループや日程調整を管理できます。</p>
      </section>
      <a className="about-row card" href="/api/auth/login" onClick={(event) => void login(event)}><span><strong>ログイン</strong><span>別の端末でも同じアカウントでログインできます。</span></span><Icon name="chevronRight" size={18} /></a>
      {loginUnavailable && <p className="form-error card" role="alert">ログイン機能はまだ設定されていません。WorkOSの環境変数が入った環境でお試しください。</p>}
    </>}
    {me && <>
      <section className="invite-card">
        <h2>アカウント</h2>
        <p className="strong">{displayName(me)}</p>
        <p className="note">{me.user.email}</p>
      </section>
      <NotificationCard />
      <p className="note">別の端末でも、同じアカウントでログインすれば自分のグループに戻れます。</p>
      <button type="button" className="ghost-btn wide" disabled={busy} onClick={() => void logout()}><Icon name="edit" size={18} />ログアウト</button>
    </>}
    <a className="about-row card" href="/"><span><strong>ホームへ戻る</strong></span><Icon name="chevronRight" size={18} /></a>
  </GuestFrame>;
}
