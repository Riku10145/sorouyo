import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hc } from 'hono/client';
import type { AppType } from '../worker';
import { DAYS, dateLabel, monthCells } from '../shared/model';
import './style.css';

const api = hc<AppType>(window.location.origin);

function Calendar() {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const month = today.slice(0, 7);
  return <section aria-labelledby="month-heading">
    <h2 id="month-heading">{month.slice(0, 4)}年{Number(month.slice(5))}月</h2>
    <p>みんなの予定を、ここから。</p>
    <div className="calendar" role="grid" aria-label="今月のカレンダー">
      <div className="week" role="row">{DAYS.map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
      {Array.from({ length: monthCells(month).length / 7 }, (_, week) => <div className="week" role="row" key={week}>
        {monthCells(month).slice(week * 7, week * 7 + 7).map(date => <span role="gridcell" key={date} aria-label={dateLabel(date, { year: true })} aria-current={date === today ? 'date' : undefined} className={date.startsWith(month) ? '' : 'outside'}>{Number(date.slice(8))}</span>)}
      </div>)}
    </div>
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
  return <section><h2>回答画面</h2>{token
    ? <p>回答画面は準備中です。招待リンクを受け付けました。</p>
    : <p role="alert">招待リンクが見つかりません。届いたURLをもう一度確認してください。</p>}</section>;
}

function App() {
  const [health, setHealth] = useState('接続確認中');
  useEffect(() => {
    let active = true;
    api.api.health.$get().then(async response => {
      const data = await response.json();
      if (active) setHealth(response.ok && data.ok ? '接続済み' : '接続を確認できません');
    }).catch(() => { if (active) setHealth('接続を確認できません'); });
    return () => { active = false; };
  }, []);
  return <main><header><h1><a href="/">そろうよ</a></h1></header>
    {window.location.pathname === '/r' ? <GuestAnswer /> : <Calendar />}
    <footer>通信状況：{health}</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
