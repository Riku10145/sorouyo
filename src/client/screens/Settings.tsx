import { useEffect, useState } from 'react';
import type { hc } from 'hono/client';
import type { AppType } from '../../worker';
import { Brand, Icon } from '../design/ui';
import { GuestFrame } from './GuestAnswer';

type Api = ReturnType<typeof hc<AppType>>;
type Me = { user: { id: string; email: string; firstName: string | null; lastName: string | null } };

const displayName = (me: Me) =>
  [me.user.lastName, me.user.firstName].filter(Boolean).join(' ') || me.user.email;

function useMe(api: Api) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    api.api.auth.me.$get().then(async response => {
      if (!active) return;
      setMe(response.ok ? await response.json() as Me : null);
    }).catch(() => { if (active) setMe(null); });
    return () => { active = false; };
  }, [api]);
  return me;
}

export function Settings({ api }: { api: Api }) {
  const me = useMe(api);
  const [busy, setBusy] = useState(false);
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
      <a className="about-row" href="/api/auth/login"><span><strong>ログイン</strong><span>別の端末でも同じアカウントでログインできます。</span></span><Icon name="chevronRight" size={18} /></a>
    </>}
    {me && <>
      <section className="invite-card">
        <h2>アカウント</h2>
        <p className="strong">{displayName(me)}</p>
        <p className="note">{me.user.email}</p>
      </section>
      <p className="note">別の端末でも、同じアカウントでログインすれば自分のグループに戻れます。</p>
      <button type="button" className="ghost-btn wide" disabled={busy} onClick={() => void logout()}><Icon name="edit" size={18} />ログアウト</button>
    </>}
    <a className="about-row" href="/"><span><strong>ホームへ戻る</strong></span><Icon name="chevronRight" size={18} /></a>
  </GuestFrame>;
}
