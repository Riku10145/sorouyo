import { useState } from 'react';
import { api } from '../../../api/client';
import { Icon } from '../../../components/Icon';
import { useMe } from '../../../hooks/useMe';
import { NotificationCard } from './NotificationCard';
import { displayName } from '../../../lib/account';

export function AccountSettings() {
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
  return <>
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
  </>;
}
