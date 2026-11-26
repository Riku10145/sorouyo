import { useEffect, useState, type FormEvent } from 'react';
import { dateLabel } from '../lib/model';
import { deleteEvent, fetchEvent, updateEvent, type CalEvent } from '../api';
import { Icon, Dot, toast, type DisplayGroup } from '../design/ui';
import { AppShell } from './Shell';
import { LoginCard } from './Auth';

/** /events/<id> 予定の詳細。所属メンバーのみ表示（#26）、メンバーは通常予定を修正できる（#9） */
export function EventDetail({ id, selectedDate }: { id: string; selectedDate: string }) {
  const [result, setResult] = useState<{ event?: CalEvent; status: number } | 'loading'>('loading');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const pollEvent = !!event.sourcePollId;

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (busy) return;
    const data = new FormData(formEvent.currentTarget);
    const title = String(data.get('title') ?? '').trim();
    const date = String(data.get('date') ?? event.date);
    const time = String(data.get('time') ?? '') || null;
    const memo = String(data.get('memo') ?? '').trim() || null;
    if (!title) { setError('予定名を入力してください'); return; }
    if (!pollEvent && !date) { setError('日付を入力してください'); return; }
    setBusy(true);
    setError(null);
    const ok = await updateEvent(event.id, { date, time, title, memo }).catch(() => false);
    setBusy(false);
    if (!ok) { setError('保存できませんでした。時間をおいて再度お試しください。'); return; }
    setResult({ status: 200, event: { ...event, title, memo, date: pollEvent ? event.date : date, startTime: pollEvent ? event.startTime : time } });
    setEditing(false);
    toast('予定を保存しました');
  };

  const remove = () => {
    if (!window.confirm('この予定を削除しますか？メンバーのカレンダーからも消えます。')) return;
    void deleteEvent(event.id).then(ok => {
      if (!ok) { toast('予定を削除できませんでした'); return; }
      toast('予定を削除しました');
      window.location.href = `/?date=${event.date}`;
    });
  };

  return <AppShell active="calendar" selectedDate={event.date} groups={[group]} subpage>
    <div className="m-only m-back"><a className="text-btn" href={`/?date=${event.date}`}><Icon name="chevronLeft" size={20} />カレンダー</a></div>
    <div className="groups-body">
      <section className="card group-head">
        <p className="eyebrow"><Dot group={group} />{group.name}</p>
        <h1>{event.title}</h1>
        <p>{dateLabel(event.date, { year: true })}{event.startTime ? ` ${event.startTime}〜` : ' 終日'}</p>
        {event.memo && <p className="hint">{event.memo}</p>}
      </section>
      {event.sourcePollId && <a className="about-row card" href={`/polls/${event.sourcePollId}`}>
        <span><strong>日程調整から決まった予定</strong><span>調整の詳細を見る</span></span><Icon name="chevronRight" size={18} />
      </a>}

      {editing ? <form className="card form-card" onSubmit={save} noValidate>
        <h2>予定を編集</h2>
        <label className="field">予定名
          <input name="title" defaultValue={event.title} maxLength={60} autoFocus />
        </label>
        <label className="field">日付
          <input name="date" type="date" defaultValue={event.date} disabled={pollEvent} />
        </label>
        <label className="field">開始時刻（空欄なら終日）
          <input name="time" type="time" defaultValue={event.startTime ?? ''} disabled={pollEvent} />
        </label>
        {pollEvent && <p className="hint">日程調整から決まった予定の日時は、調整の確定取消→再調整で変更します。</p>}
        <label className="field">メモ（任意）
          <textarea name="memo" defaultValue={event.memo ?? ''} maxLength={500} rows={3} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="about-actions">
          <button type="submit" className="primary-btn" disabled={busy}>{busy ? '保存中…' : '保存する'}</button>
          <button type="button" className="ghost-btn" onClick={() => { setEditing(false); setError(null); }}>戻る</button>
        </div>
      </form> : <div className="about-actions">
        <button type="button" className="soft-btn" onClick={() => setEditing(true)}><Icon name="edit" size={18} />予定を編集</button>
        {!pollEvent && <button type="button" className="ghost-btn" onClick={remove}><Icon name="close" size={18} />削除</button>}
      </div>}
      <p className="hint"><a href={`/?date=${event.date}`}>カレンダーに戻る</a></p>
    </div>
  </AppShell>;
}
