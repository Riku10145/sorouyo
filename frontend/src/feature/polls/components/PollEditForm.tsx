import { useState, type FormEvent } from 'react';
import { Dot } from '../../../components/Dot';
import { Icon } from '../../../components/Icon';
import { toast } from '../../../components/Toaster';
import { dateLabel } from '../../../lib/date';
import { deletePoll, updatePoll, type MemberPoll } from '../api/polls';
import { changedVotes, datetimeInput, editError, voteCount, type EditableCandidate } from '../lib/editPoll';

export function PollEditForm({ poll }: { poll: MemberPoll }) {
  const { id, group } = poll;
  const reopen = new URLSearchParams(window.location.search).get('reopen') === '1' || poll.reopenPending;
  const [title, setTitle] = useState(poll.title);
  const [deadline, setDeadline] = useState(() => datetimeInput(poll.deadlineAt));
  const [candidates, setCandidates] = useState<EditableCandidate[]>(() => poll.candidates.map(c => ({ id: c.id, date: c.date, time: c.startTime })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const updateCandidate = (index: number, patch: Partial<EditableCandidate>) =>
    setCandidates(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));

  const removeCandidate = (index: number) => {
    const target = candidates[index]!;
    const votes = voteCount(poll, target.id);
    const message = votes
      ? `${target.date ? dateLabel(target.date) : '未入力の候補'}には${votes}件の票があります。削除するとその票も消えます。削除しますか？`
      : `${target.date ? dateLabel(target.date) : '未入力の候補'}を候補から削除しますか？`;
    if (window.confirm(message)) setCandidates(current => current.filter((_, i) => i !== index));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const message = editError(title, candidates, reopen, deadline);
    if (message) { setError(message); return; }
    const votes = changedVotes(poll, candidates);
    if (votes && !window.confirm(`変更・削除される候補には合計${votes}件の票があります。票は消えますが、保存しますか？`)) return;
    setBusy(true);
    setError(null);
    const status = await updatePoll(id, {
      editVersion: poll.editVersion,
      title: title.trim(),
      deadlineAt: deadline ? new Date(`${deadline}:00+09:00`).toISOString() : null,
      candidates: candidates.map(c => ({ id: c.id, date: c.date, time: c.time })),
    }).catch(() => 0);
    setBusy(false);
    if (status !== 200) {
      setError(status === 409 ? '編集中に新しい回答または別の変更が入りました。画面を開き直して内容を確認してください。' : status === 400 ? '再調整を始めるには未来の回答締切を設定してください。' : '保存できませんでした。確定済みでないか確認して、時間をおいて再度お試しください。');
      return;
    }
    toast('日程調整を保存しました');
    window.location.href = `/polls/${id}`;
  };

  const removePoll = () => {
    if (!window.confirm('この日程調整を削除しますか？回答リンクは無効になり、回答も消えます。')) return;
    void deletePoll(id).then(ok => {
      if (!ok) { toast('日程調整を削除できませんでした'); return; }
      toast('日程調整を削除しました');
      window.location.href = '/polls';
    });
  };

  return <form className="groups-body" onSubmit={save} noValidate>
    <section className="card form-card">
      <p className="eyebrow"><Dot group={group} />{group.name}</p>
      <label className="field">予定名
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} autoFocus />
      </label>
      {reopen && <p className="form-error" role="status">確定を取り消しました。再調整を始めるには新しい回答締切を設定してください。</p>}
      <label className="field">{reopen ? '回答締切（再調整では必須・日本時間）' : '回答締切（任意・日本時間）'}
        <input type="datetime-local" value={deadline} min={new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16)} onChange={e => setDeadline(e.target.value)} />
      </label>
    </section>
    <section className="card form-card">
      <div className="section-head"><h2>候補日<span className="hint">（{candidates.length}/31件）</span></h2><button type="button" className="text-btn" disabled={candidates.length >= 31} onClick={() => setCandidates(current => [...current, { date: '', time: null }])}><Icon name="plus" size={18} />候補日を追加</button></div>
      <p className="hint">候補の日時を変えると、その候補に入っていた票は消えます。残った候補への回答は保持されます。</p>
      <ul className="group-list">
        {candidates.map((candidate, index) => <li className="card" key={candidate.id ?? `new-${index}`} style={{ padding: 12 }}>
          <div className="edit-candidate-row">
            <input type="date" value={candidate.date} aria-label={`候補${index + 1}の日付`} onChange={e => updateCandidate(index, { date: e.target.value })} />
            <input type="time" value={candidate.time ?? ''} aria-label={`候補${index + 1}の開始時刻`} onChange={e => updateCandidate(index, { time: e.target.value || null })} />
            <button type="button" className="icon-btn ghost-btn" aria-label={`候補${index + 1}を削除`} onClick={() => removeCandidate(index)}><Icon name="close" size={18} /></button>
          </div>
        </li>)}
      </ul>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="primary-btn wide" disabled={busy}>{busy ? '保存中…' : '変更を保存'}</button>
    <button type="button" className="ghost-btn wide" onClick={removePoll}><Icon name="close" size={18} />この日程調整を削除</button>
  </form>;
}
