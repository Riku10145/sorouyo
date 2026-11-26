import { useState, type FormEvent } from 'react';
import type { CalEvent } from '../../../api/calendar';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';
import { deleteEvent, updateEvent } from '../api';

export function EventEditor({ event, onSave }: { event: CalEvent; onSave: (event: CalEvent) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    onSave({ ...event, title, memo, date: pollEvent ? event.date : date, startTime: pollEvent ? event.startTime : time });
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

  return editing ? <form className="card form-card" onSubmit={save} noValidate>
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
  </div>;
}
