import { useEffect, useState } from 'react';
import { dateLabel } from '../../shared/model';
import { fetchEvent, type CalEvent } from '../api';
import { Icon, Dot, type DisplayGroup } from '../design/ui';
import { AppShell } from './Shell';
import { LoginCard } from './Auth';

/** /events/<id> 予定の詳細。所属メンバーのみ表示（#26） */
export function EventDetail({ id, selectedDate }: { id: string; selectedDate: string }) {
  const [result, setResult] = useState<{ event?: CalEvent; status: number } | 'loading'>('loading');
  useEffect(() => {
    let active = true;
    fetchEvent(id).then(found => { if (active) setResult(found); })
      .catch(() => { if (active) setResult({ status: 0 }); });
    return () => { active = false; };
  }, [id]);

  if (result === 'loading') return null;

  if (!result.event) {
    const login = result.status === 401;
    return <AppShell active="calendar" selectedDate={selectedDate} groups={[]} subpage>
      {login ? <LoginCard next={`/events/${id}`} note="この予定はログインしたメンバーだけが見られます。" />
        : <section className="notice-card" role="alert" style={{ margin: '24px 16px' }}>
          <Icon name="link" size={32} /><h2>予定を開けません</h2>
          <p>権限がないか、削除された可能性があります。</p>
          <a className="soft-btn" href="/">カレンダーへ戻る</a>
        </section>}
    </AppShell>;
  }

  const event = result.event;
  const group: DisplayGroup = event.group;
  return <AppShell active="calendar" selectedDate={event.date} groups={[group]} subpage>
    <div className="m-only m-back"><a className="text-btn" href={`/?date=${event.date}`}><Icon name="chevronLeft" size={20} />カレンダー</a></div>
    <div className="groups-body">
      <section className="card group-head">
        <p className="eyebrow"><Dot group={group} />{group.name}</p>
        <h1>{event.title}</h1>
        <p>{dateLabel(event.date, { year: true })}{event.startTime ? ` ${event.startTime}〜` : ' 終日'}</p>
      </section>
      {event.sourcePollId && <a className="about-row card" href={`/polls/${event.sourcePollId}`}>
        <span><strong>日程調整から決まった予定</strong><span>調整の詳細を見る</span></span><Icon name="chevronRight" size={18} />
      </a>}
      <p className="hint"><a href={`/?date=${event.date}`}>カレンダーに戻る</a></p>
    </div>
  </AppShell>;
}
