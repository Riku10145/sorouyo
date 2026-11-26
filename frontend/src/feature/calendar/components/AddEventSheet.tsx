import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { GroupInfo } from '../../../api/groups';
import { toast } from '../../../components/Toaster';
import { dateLabel } from '../../../lib/date';
import { createEvent } from '../api';

export function AddEventSheet({ groups, date, onClose, onCreated }: {
  groups: GroupInfo[]; date: string; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sheet = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      // IME変換中のキー（変換キャンセルのEscape・候補選択のTab）はシートを操作しない
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const form = sheet.current;
      if (e.key !== 'Tab' || !form) return;

      const controls = Array.from(form.querySelectorAll<HTMLElement>('input, select, button'))
        .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (!form.contains(active) || active === (e.shiftKey ? first : last)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('タイトルを入力してください'); return; }
    setBusy(true);
    const created = await createEvent(groupId, { date, title: title.trim(), time: time || null }).catch(() => null);
    setBusy(false);
    if (!created) { setError('保存できませんでした'); return; }
    toast('予定を追加しました');
    onCreated();
  };

  return <div className="sheet-backdrop" onClick={onClose} role="presentation">
    <form ref={sheet} className="sheet card" onSubmit={submit} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${dateLabel(date)}の予定を追加`}>
      <h2>{dateLabel(date)}の予定を追加</h2>
      <label className="field">タイトル<input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} autoFocus /></label>
      <label className="field">グループ<select value={groupId} onChange={e => setGroupId(e.target.value)}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label className="field">時刻（空欄なら終日）<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      {error && <p className="form-error">{error}</p>}
      <div className="about-actions">
        <button type="button" className="ghost-btn" onClick={onClose}>キャンセル</button>
        <button type="submit" className="primary-btn" disabled={busy}>{busy ? '保存中…' : '追加する'}</button>
      </div>
    </form>
  </div>;
}
