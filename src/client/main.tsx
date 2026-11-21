import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hc } from 'hono/client';
import type { AppType } from '../worker';
import { DAYS, dateLabel, monthCells } from '../shared/model';
import './style.css';

const api = hc<AppType>(window.location.origin);

type Me = { user: { id: string; email: string; firstName: string | null; lastName: string | null } };

const displayName = (me: Me) =>
  [me.user.lastName, me.user.firstName].filter(Boolean).join(' ') || me.user.email;

function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    api.api.auth.me.$get().then(async response => {
      if (!active) return;
      setMe(response.ok ? await response.json() : null);
    }).catch(() => { if (active) setMe(null); });
    return () => { active = false; };
  }, []);
  return me;
}

function Nav({ me }: { me: Me | null | undefined }) {
  if (me === undefined) return null;
  return <nav>{me
    ? <a href="/settings">{displayName(me)}</a>
    : <a href="/api/auth/login">ログイン</a>}</nav>;
}

function Calendar() {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const month = today.slice(0, 7);
  const cells = monthCells(month);
  return <section aria-labelledby="month-heading">
    <h2 id="month-heading">{month.slice(0, 4)}年{Number(month.slice(5))}月</h2>
    <p>みんなの予定を、ここから。</p>
    <table className="calendar" aria-label="今月のカレンダー">
      <thead><tr>{DAYS.map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
      <tbody>{Array.from({ length: cells.length / 7 }, (_, week) => <tr key={week}>
        {cells.slice(week * 7, week * 7 + 7).map(date => <td key={date} aria-label={dateLabel(date, { year: true })} aria-current={date === today ? 'date' : undefined} className={date.startsWith(month) ? '' : 'outside'}>{Number(date.slice(8))}</td>)}
      </tr>)}</tbody>
    </table>
    <p className="muted">今日の日付は日本時間で表示しています。</p>
  </section>;
}

function GuestAnswer() {
  const [token, setToken] = useState(window.location.hash.slice(1).trim());
  useEffect(() => {
    const update = () => setToken(window.location.hash.slice(1).trim());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (token) api.api.guest.session.$post().catch(() => {});
  }, [token]);
  return <section><h2>回答画面</h2>{token
    ? <p>回答画面は準備中です。招待リンクを受け付けました。</p>
    : <p role="alert">招待リンクが見つかりません。届いたURLをもう一度確認してください。</p>}</section>;
}

function Settings() {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (me === undefined) return <section><h2>設定</h2><p>読み込み中…</p></section>;
  if (me === null) return <section><h2>設定</h2>
    <p>ログインしていません。</p>
    <p><a href="/api/auth/login">ログイン</a></p>
  </section>;
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
  return <section><h2>設定</h2>
    <dl>
      <dt>アカウント</dt><dd>{displayName(me)}（{me.user.email}）</dd>
    </dl>
    <p>別の端末でも、同じアカウントでログインすれば自分のグループに戻れます。</p>
    <button type="button" disabled={busy} onClick={() => void logout()}>ログアウト</button>
  </section>;
}

function App() {
  const [health, setHealth] = useState('接続確認中');
  const me = useMe();
  useEffect(() => {
    let active = true;
    api.api.health.$get().then(async response => {
      const data = await response.json();
      if (active) setHealth(response.ok && data.ok ? '接続済み' : '接続を確認できません');
    }).catch(() => { if (active) setHealth('接続を確認できません'); });
    return () => { active = false; };
  }, []);
  const path = window.location.pathname;
  return <main><header><h1><a href="/">そろうよ</a></h1><Nav me={me} /></header>
    {['/r', '/r/'].includes(path) ? <GuestAnswer /> : path === '/settings' ? <Settings /> : <Calendar />}
    <footer>通信状況：{health}</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
